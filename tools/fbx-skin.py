#!/usr/bin/env python3
"""从二进制 FBX 里把骨架和蒙皮抠出来，写成 glTF（.gltf + .bin）。

为什么自己写：这台机器上没有 Blender，也没有 FBX2glTF，而 OBJ 那条老路
不带骨头。牛来这个模型是双足 T-Pose，手臂平举，不驱动骨骼就没法看。

抠三样东西：
  1. Geometry::Mesh          顶点、多边形、UV、法线
  2. Model::LimbNode         骨头，以及它们之间的父子连接
  3. Deformer::Cluster       每根骨头影响哪些顶点、权重多少、绑定矩阵是什么

FBX 的坑：
  - Connections 是 (子, 父) 的顺序，而且 OO 和 OP 两种要分开看
  - 每个节点的局部变换要按 FBX 的合成顺序拼：
      T * Roff * Rp * Rpre * R * Rpost⁻¹ * Rp⁻¹ * Soff * Sp * S * Sp⁻¹
    偷懒只用 T/R/S 的话，带 PreRotation 的骨架会整个歪掉
  - 旋转次序默认 XYZ（EulerXYZ），但属性里可能写着别的
"""
import struct, sys, zlib, os, json, math
from array import array
from collections import defaultdict

FBXTIME = 46186158000


# ---------------------------------------------------------------- FBX 读取
class Reader:
    def __init__(self, path):
        self.f = open(path, 'rb')
        head = self.f.read(27)
        if head[:20] != b'Kaydara FBX Binary  ':
            raise SystemExit('不是二进制 FBX')
        self.ver = struct.unpack('<I', head[23:27])[0]
        self.wide = self.ver >= 7500
        self.size = os.path.getsize(path)

    def read_array(self, typ):
        n, enc, clen = struct.unpack('<III', self.f.read(12))
        raw = self.f.read(clen)
        if enc == 1:
            raw = zlib.decompress(raw)
        code = {'f': 'f', 'd': 'd', 'i': 'i', 'l': 'q', 'b': 'b'}[typ]
        a = array(code)
        a.frombytes(raw[:n * a.itemsize])
        return a

    def read_props(self, count):
        out = []
        for _ in range(count):
            t = self.f.read(1).decode('ascii')
            if t == 'Y': out.append(struct.unpack('<h', self.f.read(2))[0])
            elif t == 'C': out.append(bool(self.f.read(1)[0]))
            elif t == 'I': out.append(struct.unpack('<i', self.f.read(4))[0])
            elif t == 'F': out.append(struct.unpack('<f', self.f.read(4))[0])
            elif t == 'D': out.append(struct.unpack('<d', self.f.read(8))[0])
            elif t == 'L': out.append(struct.unpack('<q', self.f.read(8))[0])
            elif t in 'fdilb': out.append(self.read_array(t))
            elif t in 'SR':
                ln = struct.unpack('<I', self.f.read(4))[0]
                raw = self.f.read(ln)
                out.append(raw.decode('utf8', 'replace') if t == 'S' else raw)
            else:
                raise ValueError(f'未知属性类型 {t!r}')
        return out

    def read_node(self):
        if self.wide:
            end, nprops, _ = struct.unpack('<QQQ', self.f.read(24))
        else:
            end, nprops, _ = struct.unpack('<III', self.f.read(12))
        nlen = self.f.read(1)[0]
        if end == 0:
            return None
        name = self.f.read(nlen).decode('utf8', 'replace')
        props = self.read_props(nprops)
        return {'name': name, 'props': props, 'end': end}

    def children(self, end):
        """读出这一层的所有子节点，每个带自己的数据区起止。"""
        out = []
        limit = 25 if self.wide else 13
        while self.f.tell() < end - limit:
            pos = self.f.tell()
            n = self.read_node()
            if n is None:
                break
            n['body'] = self.f.tell()
            out.append(n)
            self.f.seek(n['end'])
        return out

    def subtree(self, node):
        self.f.seek(node['body'])
        return self.children(node['end'])


def load(path):
    """把 Objects 和 Connections 读成好用的形状。"""
    r = Reader(path)
    r.f.seek(27)
    top = r.children(r.size)
    objs, conns = {}, []
    for t in top:
        if t['name'] == 'Objects':
            for o in r.subtree(t):
                if len(o['props']) < 3:
                    continue
                oid, name, sub = o['props'][0], o['props'][1], o['props'][2]
                objs[oid] = {'id': oid, 'type': o['name'], 'name': name,
                             'sub': sub, 'node': o, 'r': r}
        elif t['name'] == 'Connections':
            for c in r.subtree(t):
                p = c['props']
                if len(p) >= 3:
                    conns.append((p[0], p[1], p[2], p[3] if len(p) > 3 else None))
    return r, objs, conns


def kids(r, obj, want=None):
    """某个对象下面的直接子节点，按名字取。"""
    out = defaultdict(list)
    for c in r.subtree(obj['node']):
        if want is None or c['name'] in want:
            out[c['name']].append(c)
    return out


def props70(r, obj):
    """Properties70 里的 key -> 值列表。"""
    out = {}
    for c in r.subtree(obj['node']):
        if c['name'] != 'Properties70':
            continue
        for p in r.subtree(c):
            if p['name'] == 'P' and p['props']:
                out[p['props'][0]] = p['props'][4:]
    return out


# ---------------------------------------------------------------- 矩阵
def mat_ident():
    return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]


def mat_mul(a, b):
    """列主序 4x4，返回 a*b（先做 b 再做 a）。"""
    o = [0.0] * 16
    for c in range(4):
        for r_ in range(4):
            o[c * 4 + r_] = sum(a[k * 4 + r_] * b[c * 4 + k] for k in range(4))
    return o


def mat_T(t):
    m = mat_ident(); m[12], m[13], m[14] = t
    return m


def mat_S(s):
    m = mat_ident(); m[0], m[5], m[10] = s
    return m


def mat_R(deg, order='XYZ'):
    x, y, z = (math.radians(v) for v in deg)
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    Rx = [1,0,0,0, 0,cx,sx,0, 0,-sx,cx,0, 0,0,0,1]
    Ry = [cy,0,-sy,0, 0,1,0,0, sy,0,cy,0, 0,0,0,1]
    Rz = [cz,sz,0,0, -sz,cz,0,0, 0,0,1,0, 0,0,0,1]
    tbl = {'X': Rx, 'Y': Ry, 'Z': Rz}
    m = mat_ident()
    # FBX 的 EulerXYZ 是先绕 X 再 Y 再 Z（左乘），所以按 Z*Y*X 拼
    for ax in reversed(order):
        m = mat_mul(m, tbl[ax])
    return m


def mat_inv(m):
    """通用 4x4 求逆（高斯消元），骨骼矩阵不保证是刚体变换。"""
    a = [[m[c * 4 + r] for c in range(4)] + [1.0 if r == c2 else 0.0 for c2 in range(4)]
         for r in range(4)]
    for i in range(4):
        piv = max(range(i, 4), key=lambda k: abs(a[k][i]))
        if abs(a[piv][i]) < 1e-12:
            return mat_ident()
        a[i], a[piv] = a[piv], a[i]
        d = a[i][i]
        a[i] = [v / d for v in a[i]]
        for k in range(4):
            if k != i and a[k][i]:
                f = a[k][i]
                a[k] = [v - f * w for v, w in zip(a[k], a[i])]
    return [a[r][4 + c] for c in range(4) for r in range(4)]


ROT_ORDER = ['XYZ', 'XZY', 'YZX', 'YXZ', 'ZXY', 'ZYX', 'XYZ']


def local_matrix(pr):
    """按 FBX 的合成顺序拼出节点的局部变换。

    T * Roff * Rp * Rpre * R * Rpost⁻¹ * Rp⁻¹ * Soff * Sp * S * Sp⁻¹

    少了 Rpre 这一段，带 PreRotation 的骨架会整个歪掉，这是 FBX 最常见的坑。
    """
    g = lambda k, d: [float(v) for v in pr.get(k, d)][:3] if k in pr else list(d)
    T = g('Lcl Translation', (0, 0, 0))
    R = g('Lcl Rotation', (0, 0, 0))
    S = g('Lcl Scaling', (1, 1, 1))
    Rpre = g('PreRotation', (0, 0, 0))
    Rpost = g('PostRotation', (0, 0, 0))
    Roff = g('RotationOffset', (0, 0, 0))
    Rp = g('RotationPivot', (0, 0, 0))
    Soff = g('ScalingOffset', (0, 0, 0))
    Sp = g('ScalingPivot', (0, 0, 0))
    order = ROT_ORDER[int(pr['RotationOrder'][0])] if 'RotationOrder' in pr else 'XYZ'

    m = mat_T(T)
    m = mat_mul(m, mat_T(Roff))
    m = mat_mul(m, mat_T(Rp))
    m = mat_mul(m, mat_R(Rpre))
    m = mat_mul(m, mat_R(R, order))
    m = mat_mul(m, mat_inv(mat_R(Rpost)))
    m = mat_mul(m, mat_inv(mat_T(Rp)))
    m = mat_mul(m, mat_T(Soff))
    m = mat_mul(m, mat_T(Sp))
    m = mat_mul(m, mat_S(S))
    m = mat_mul(m, mat_inv(mat_T(Sp)))
    return m


def decompose(m):
    """拆成 T / R(四元数) / S，glTF 节点要这三样。"""
    t = [m[12], m[13], m[14]]
    cols = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]]
    s = [math.sqrt(sum(v * v for v in c)) or 1.0 for c in cols]
    # 左手系翻转时行列式为负，把 X 轴的缩放取负还原
    det = (cols[0][0] * (cols[1][1] * cols[2][2] - cols[1][2] * cols[2][1])
           - cols[1][0] * (cols[0][1] * cols[2][2] - cols[0][2] * cols[2][1])
           + cols[2][0] * (cols[0][1] * cols[1][2] - cols[0][2] * cols[1][1]))
    if det < 0:
        s[0] = -s[0]
    R = [[cols[c][r] / s[c] for c in range(3)] for r in range(3)]
    tr = R[0][0] + R[1][1] + R[2][2]
    if tr > 0:
        w = math.sqrt(tr + 1) * 0.5; f = 0.25 / w
        q = [(R[2][1] - R[1][2]) * f, (R[0][2] - R[2][0]) * f, (R[1][0] - R[0][1]) * f, w]
    elif R[0][0] > R[1][1] and R[0][0] > R[2][2]:
        d = math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) * 2; f = 1 / d
        q = [0.25 * d, (R[0][1] + R[1][0]) * f, (R[0][2] + R[2][0]) * f, (R[2][1] - R[1][2]) * f]
    elif R[1][1] > R[2][2]:
        d = math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]) * 2; f = 1 / d
        q = [(R[0][1] + R[1][0]) * f, 0.25 * d, (R[1][2] + R[2][1]) * f, (R[0][2] - R[2][0]) * f]
    else:
        d = math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]) * 2; f = 1 / d
        q = [(R[0][2] + R[2][0]) * f, (R[1][2] + R[2][1]) * f, 0.25 * d, (R[1][0] - R[0][1]) * f]
    n = math.sqrt(sum(v * v for v in q)) or 1
    return t, [v / n for v in q], s


# ---------------------------------------------------------------- 主流程
def main():
    src = sys.argv[1]
    out_prefix = sys.argv[2]
    tex = sys.argv[3] if len(sys.argv) > 3 else None

    print('[skin] 读 FBX ...')
    r, objs, conns = load(src)

    # 子 -> 父，父 -> 子。
    # 只认 Model 之间的连接：一根骨头同时还会连到自己的 Cluster 上，
    # 不加这个判断，父节点会被 Cluster 覆盖掉，整棵骨架散成一堆孤立的根。
    parent = {}
    child_of = defaultdict(list)
    for kind, cid, pid, _p in conns:
        if kind != 'OO':
            continue
        c, p = objs.get(cid), objs.get(pid)
        if c and c['type'] == 'Model' and p and p['type'] == 'Model':
            parent[cid] = pid
            child_of[pid].append(cid)

    meshes = [o for o in objs.values() if o['type'] == 'Geometry' and o['sub'] == 'Mesh']
    limbs = [o for o in objs.values() if o['type'] == 'Model' and o['sub'] == 'LimbNode']
    skins = [o for o in objs.values() if o['type'] == 'Deformer' and o['sub'] == 'Skin']
    clusters = [o for o in objs.values() if o['type'] == 'Deformer' and o['sub'] == 'Cluster']
    print(f'  网格 {len(meshes)}　骨头 {len(limbs)}　Skin {len(skins)}　Cluster {len(clusters)}')
    if not meshes:
        raise SystemExit('没有网格')

    geo = meshes[0]
    gk = kids(r, geo)

    def arr(name, idx=0):
        n = gk.get(name)
        if not n:
            return None
        r.f.seek(n[idx]['body'])
        node = r.read_node()
        return None if node is None else node['props'][0] if node['props'] else None

    # 几何：顶点和多边形索引
    def first_array(nodes):
        for n in nodes:
            if n['props'] and isinstance(n['props'][0], array):
                return n['props'][0]
        return None

    V = first_array(gk.get('Vertices', []))
    PI = first_array(gk.get('PolygonVertexIndex', []))
    if V is None or PI is None:
        raise SystemExit('几何数据不全')

    # UV 层
    uv = uvi = uv_map = uv_ref = None
    for layer in r.subtree(geo['node']):
        if layer['name'] != 'LayerElementUV':
            continue
        for c in r.subtree(layer):
            if c['name'] == 'UV': uv = c['props'][0]
            elif c['name'] == 'UVIndex': uvi = c['props'][0]
            elif c['name'] == 'MappingInformationType': uv_map = c['props'][0]
            elif c['name'] == 'ReferenceInformationType': uv_ref = c['props'][0]
        break

    print(f'  顶点 {len(V)//3:,}　多边形索引 {len(PI):,}　UV {(len(uv)//2) if uv else 0:,}'
          f'（{uv_map} / {uv_ref}）')

    # 蒙皮：cluster -> 骨头
    # Cluster 和骨头的连接方向是 (骨头 -> Cluster)，别搞反
    cluster_bone = {}
    for kind, cid, pid, _p in conns:
        if kind != 'OO':
            continue
        c, p = objs.get(cid), objs.get(pid)
        if c and p and p['sub'] == 'Cluster' and c['sub'] == 'LimbNode':
            cluster_bone[pid] = cid

    print(f'  cluster→骨头 映射 {len(cluster_bone)}')

    # 骨头顺序：从根开始深度优先，保证父节点排在子节点前面
    limb_ids = {o['id'] for o in limbs}
    roots = [i for i in limb_ids if parent.get(i) not in limb_ids]
    order, seen = [], set()

    def dfs(i):
        if i in seen:
            return
        seen.add(i); order.append(i)
        for c in child_of.get(i, []):
            if c in limb_ids:
                dfs(c)
    for i in sorted(roots):
        dfs(i)
    for i in sorted(limb_ids):
        dfs(i)
    print(f'  骨头层级：根 {len(roots)} 个，排序后 {len(order)} 根')

    bone_index = {bid: k for k, bid in enumerate(order)}

    # 每根骨头的局部变换。
    # 不从 Lcl Translation/Rotation 那套属性去拼——FBX 的合成顺序里还夹着
    # PreRotation/PostRotation/各种 pivot，稍有出入整条链就偏，实测 34 根骨头
    # 全部对不上（腿部误差正好 2.0，即 180° 翻转）。
    # Cluster 里的 TransformLink 本身就是这根骨头在绑定期的全局变换，
    # 用它反推局部变换：local = inverse(父的 TransformLink) * 自己的 TransformLink。
    # 这样 IBM * global == I 按构造就成立。
    bone_local = {}

    # 蒙皮权重
    nv = len(V) // 3
    infl = [[] for _ in range(nv)]
    ibm = {}
    link = {}          # 骨头 -> 绑定期全局变换（TransformLink）
    mesh_bind = [None]  # 网格自己的绑定变换，所有 cluster 里都一样
    for cid, bid in cluster_bone.items():
        cl = objs[cid]
        ck = kids(r, cl)
        idxs = first_array(ck.get('Indexes', []))
        wts = first_array(ck.get('Weights', []))
        tl = first_array(ck.get('TransformLink', []))
        tf = first_array(ck.get('Transform', []))
        if tl is not None and tf is not None:
            link[bid] = list(tl)
            # glTF 规定蒙皮网格自身的节点变换被忽略，所以网格的绑定变换 Transform
            # 不能靠节点带，得烘进顶点里。烘完之后 IBM 就是纯粹的 inv(TransformLink)。
            mesh_bind[0] = list(tf)
            ibm[bid] = mat_inv(list(tl))
        if idxs is None or wts is None:
            continue
        bi = bone_index[bid]
        for vi, w in zip(idxs, wts):
            if 0 <= vi < nv and w > 0:
                infl[vi].append((bi, float(w)))

    # 有 TransformLink 的用它反推；没有的（末端骨，不带权重）退回 Lcl 那套
    for bid in order:
        pid = parent.get(bid)
        if bid in link:
            bone_local[bid] = mat_mul(mat_inv(link[pid]), link[bid]) if pid in link else link[bid]
        else:
            bone_local[bid] = local_matrix(props70(r, objs[bid]))

    # 自查：IBM 乘以按层级重建的全局变换必须是单位阵
    glob = {}
    worst = 0.0
    for bid in order:
        pid = parent.get(bid)
        glob[bid] = bone_local[bid] if pid not in glob else mat_mul(glob[pid], bone_local[bid])
        if bid in ibm:
            e = max(abs(a - b) for a, b in zip(mat_mul(ibm[bid], glob[bid]), mat_ident()))
            worst = max(worst, e)
    print(f'  绑定矩阵自查：最大偏差 {worst:.5f}' + ('  ← 不对' if worst > 0.01 else '  ok'))

    bound = sum(1 for x in infl if x)
    print(f'  有权重的顶点 {bound:,}/{nv:,}　绑定矩阵 {len(ibm)}')
    if bound == 0:
        raise SystemExit('没解出任何蒙皮权重')

    # ---------------------------------------------------------------- 组装几何
    # 法线层
    nrm = nrm_map = nrm_ref = None
    nrm_i = None
    for layer in r.subtree(geo['node']):
        if layer['name'] != 'LayerElementNormal':
            continue
        for c in r.subtree(layer):
            if c['name'] == 'Normals': nrm = c['props'][0]
            elif c['name'] == 'NormalsIndex': nrm_i = c['props'][0]
            elif c['name'] == 'MappingInformationType': nrm_map = c['props'][0]
            elif c['name'] == 'ReferenceInformationType': nrm_ref = c['props'][0]
        break

    # 每个顶点最多 4 根骨头，权重归一
    J, Wt = [], []
    for lst in infl:
        lst = sorted(lst, key=lambda x: -x[1])[:4]
        tot = sum(w for _, w in lst) or 1.0
        j = [0, 0, 0, 0]; w = [0.0, 0.0, 0.0, 0.0]
        for k, (bi, ww) in enumerate(lst):
            j[k] = bi; w[k] = ww / tot
        J.append(j); Wt.append(w)

    # 顶点本来就在和 TransformLink 同一个坐标系里（实测包围盒和骨头范围吻合），
    # 所以 Cluster 的 Transform 不要往顶点上乘——乘了模型会整个躺倒。
    # IBM 就是纯粹的 inv(TransformLink)。
    MB = None
    if MB:
        Vt = array('d', [0.0]) * 0
        Vt = list(V)
        for i in range(0, len(Vt), 3):
            x, y, z = Vt[i], Vt[i+1], Vt[i+2]
            Vt[i]   = MB[0]*x + MB[4]*y + MB[8]*z  + MB[12]
            Vt[i+1] = MB[1]*x + MB[5]*y + MB[9]*z  + MB[13]
            Vt[i+2] = MB[2]*x + MB[6]*y + MB[10]*z + MB[14]
        V = Vt
        if nrm is not None:
            Nt = list(nrm)
            for i in range(0, len(Nt), 3):
                x, y, z = Nt[i], Nt[i+1], Nt[i+2]
                Nt[i]   = MB[0]*x + MB[4]*y + MB[8]*z
                Nt[i+1] = MB[1]*x + MB[5]*y + MB[9]*z
                Nt[i+2] = MB[2]*x + MB[6]*y + MB[10]*z
            nrm = Nt

    # 三角化 + 去重。FBX 用负数标记多边形结尾（真索引是 ~v）
    pos_out, uv_out, nrm_out, j_out, w_out, idx_out = [], [], [], [], [], []
    dedup = {}
    poly, corner = [], []
    ci = 0
    for k, v in enumerate(PI):
        vi = ~v if v < 0 else v
        poly.append(vi); corner.append(k)
        if v < 0:
            for t in range(1, len(poly) - 1):
                for a in (0, t, t + 1):
                    pv, pc = poly[a], corner[a]
                    if uv is not None:
                        ui = uvi[pc] if (uvi is not None and uv_ref == 'IndexToDirect') else pc
                        key_uv = ui
                    else:
                        key_uv = -1
                    if nrm is not None:
                        ni = nrm_i[pc] if (nrm_i is not None and nrm_ref == 'IndexToDirect') else pc
                    else:
                        ni = -1
                    key = (pv, key_uv, ni)
                    got = dedup.get(key)
                    if got is None:
                        got = len(pos_out) // 3
                        dedup[key] = got
                        pos_out += [V[pv*3], V[pv*3+1], V[pv*3+2]]
                        if key_uv >= 0: uv_out += [uv[key_uv*2], 1.0 - uv[key_uv*2+1]]
                        else: uv_out += [0.0, 0.0]
                        if ni >= 0 and ni*3+2 < len(nrm): nrm_out += [nrm[ni*3], nrm[ni*3+1], nrm[ni*3+2]]
                        else: nrm_out += [0.0, 1.0, 0.0]
                        j_out += J[pv]; w_out += Wt[pv]
                    idx_out.append(got)
            poly, corner = [], []
    print(f'  三角面 {len(idx_out)//3:,}　去重后顶点 {len(pos_out)//3:,}')

    # ---------------------------------------------------------------- 写 glTF
    import struct as _st
    def pack(fmt, data):
        return _st.pack('<' + fmt * len(data), *data)

    blobs, views, accs = [], [], []
    def add(data, fmt, ctype, atype, target=None, minmax=False):
        raw = pack(fmt, data)
        while len(raw) % 4: raw += b'\x00'
        off = sum(len(b) for b in blobs)
        blobs.append(raw)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(raw)}
        if target: v['target'] = target
        views.append(v)
        comp = {'f': 4, 'H': 2, 'I': 4}[fmt]
        n = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[atype]
        a = {'bufferView': len(views)-1, 'componentType': ctype,
             'count': len(data)//n, 'type': atype}
        if minmax:
            cols = [data[i::n] for i in range(n)]
            a['min'] = [min(c) for c in cols]; a['max'] = [max(c) for c in cols]
        accs.append(a)
        return len(accs) - 1

    A_POS = add(pos_out, 'f', 5126, 'VEC3', 34962, True)
    A_NRM = add(nrm_out, 'f', 5126, 'VEC3', 34962)
    A_UV  = add(uv_out,  'f', 5126, 'VEC2', 34962)
    A_J   = add(j_out,   'H', 5123, 'VEC4', 34962)
    A_W   = add(w_out,   'f', 5126, 'VEC4', 34962)
    big = len(pos_out)//3 > 65535
    A_IDX = add(idx_out, 'I' if big else 'H', 5125 if big else 5123, 'SCALAR', 34963)

    ibm_flat = []
    for b in order:
        m = ibm.get(b) or mat_ident()
        ibm_flat += [float(x) for x in m]
    A_IBM = add(ibm_flat, 'f', 5126, 'MAT4')

    nodes = []
    for k, b in enumerate(order):
        t, q, sc = decompose(bone_local[b])
        n = {'name': objs[b]['name'].split('\x00')[0],
             'translation': t, 'rotation': q, 'scale': sc}
        ch = [bone_index[c] for c in child_of.get(b, []) if c in bone_index]
        if ch: n['children'] = ch
        nodes.append(n)
    mesh_node = len(nodes)
    nodes.append({'name': 'niulai', 'mesh': 0, 'skin': 0})

    root_bone = bone_index[order[0]]
    g = {
        'asset': {'version': '2.0', 'generator': 'fbx-skin.py'},
        'scene': 0,
        'scenes': [{'nodes': [root_bone, mesh_node]}],
        'nodes': nodes,
        'skins': [{'inverseBindMatrices': A_IBM, 'joints': list(range(len(order))),
                   'skeleton': root_bone}],
        'meshes': [{'primitives': [{
            'attributes': {'POSITION': A_POS, 'NORMAL': A_NRM, 'TEXCOORD_0': A_UV,
                           'JOINTS_0': A_J, 'WEIGHTS_0': A_W},
            'indices': A_IDX, 'material': 0}]}],
        'materials': [{'pbrMetallicRoughness': {
            'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0.0, 'roughnessFactor': 1.0},
            'name': 'niulai'}],
        'accessors': accs,
        'bufferViews': views,
        'buffers': [{'byteLength': sum(len(b) for b in blobs), 'uri': os.path.basename(out_prefix) + '.bin'}],
    }
    if tex:
        g['images'] = [{'uri': os.path.basename(tex)}]
        g['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
        g['textures'] = [{'source': 0, 'sampler': 0}]
        g['materials'][0]['pbrMetallicRoughness']['baseColorTexture'] = {'index': 0}

    open(out_prefix + '.bin', 'wb').write(b''.join(blobs))
    json.dump(g, open(out_prefix + '.gltf', 'w'))
    print(f'[skin] 写出 {out_prefix}.gltf  ({sum(len(b) for b in blobs)/1048576:.2f} MB bin)')


if __name__ == '__main__':
    main()
