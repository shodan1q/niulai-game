#!/usr/bin/env python3
"""从二进制 FBX 里抽出几何，写成带 UV 的 OBJ（+ MTL）。

用法:  python3 tools/fbx2obj.py <in.fbx> <out.obj>

GooFstore 那几个包里只有 FBX 带 UV 和贴图（OBJ 版有的包压根没有，STL/3MF 又没有 UV），
所以需要能直接读 FBX。产出的 OBJ 再交给 tools/build-model.mjs 做减面和压缩。

只处理静态网格：Vertices / PolygonVertexIndex / LayerElementUV。
骨骼不在这里处理——真拿到带骨骼的模型应该走 GLB，three.js 直接就能用。
"""
import os, struct, sys, zlib
from array import array

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
        pos = self.f.tell()
        if self.wide:
            end, nprops, _plen = struct.unpack('<QQQ', self.f.read(24))
            nlen = self.f.read(1)[0]
        else:
            end, nprops, _plen = struct.unpack('<III', self.f.read(12))
            nlen = self.f.read(1)[0]
        if end == 0:
            return None
        name = self.f.read(nlen).decode('utf8', 'replace')
        props = self.read_props(nprops)
        return {'name': name, 'props': props, 'end': end, 'start': pos}

    def walk(self, end, want, parent=None, out=None):
        """收集 name 在 want 里的节点，连同它的父节点名。

        父节点名必须记：MappingInformationType / ReferenceInformationType 这两个名字
        在 LayerElementNormal、LayerElementUV、LayerElementMaterial 下面都有，
        不区分父节点就会把法线层的设置当成 UV 层的，UV 索引直接算错。
        """
        if out is None:
            out = []
        limit = 25 if self.wide else 13
        while self.f.tell() < end - limit:
            node = self.read_node()
            if node is None:
                break
            if node['name'] in want:
                node['parent'] = parent
                out.append(node)
            if self.f.tell() < node['end']:
                self.walk(node['end'], want, node['name'], out)
            self.f.seek(node['end'])
        return out


def find_geometry(path):
    r = Reader(path)
    r.f.seek(27)
    want = {'Vertices', 'PolygonVertexIndex', 'UV', 'UVIndex',
            'MappingInformationType', 'ReferenceInformationType'}
    nodes = r.walk(r.size, want)
    got = {}
    for n in nodes:
        p, nm, par = n['props'], n['name'], n.get('parent')
        if not p:
            continue
        if nm == 'Vertices': got.setdefault('V', p[0])
        elif nm == 'PolygonVertexIndex': got.setdefault('PI', p[0])
        elif nm == 'UV': got.setdefault('UV', p[0])
        elif nm == 'UVIndex': got.setdefault('UVI', p[0])
        elif par == 'LayerElementUV':                     # 只认 UV 层里的
            if nm == 'MappingInformationType': got.setdefault('map', p[0])
            elif nm == 'ReferenceInformationType': got.setdefault('ref', p[0])
    return got


# ---------------------------------------------------------------- 主流程
def main():
    src, dst = sys.argv[1], sys.argv[2]
    tex = sys.argv[3] if len(sys.argv) > 3 else None

    print('[fbx2obj] 读 FBX ...')
    g = find_geometry(src)
    V, PI = g.get('V'), g.get('PI')
    if V is None or PI is None:
        raise SystemExit('FBX 里没找到 Vertices / PolygonVertexIndex')
    UV, UVI = g.get('UV'), g.get('UVI')
    mapping, ref = g.get('map', ''), g.get('ref', '')
    print(f'  顶点 {len(V)//3:,}　多边形索引 {len(PI):,}　'
          f'UV {len(UV)//2 if UV else 0:,}（{mapping} / {ref}）')

    # PolygonVertexIndex：负数表示该多边形的最后一个索引，真值是 ~v
    print('[fbx2obj] 三角化 ...')
    faces = []          # 每项是 [(vi, uvi), ...]
    poly = []
    nUV = len(UV) // 2 if UV is not None else 0
    use_index = UVI is not None and ref == 'IndexToDirect'
    for k, v in enumerate(PI):
        last = v < 0
        vi = ~v if last else v
        if UV is None:
            uvi = None
        elif use_index:
            uvi = UVI[k]
        elif mapping == 'ByVertice' or mapping == 'ByVertex':
            uvi = vi                                  # 每个顶点一个 UV
        else:
            uvi = k                                   # ByPolygonVertex + Direct
        poly.append((vi, uvi))
        if last:
            for t in range(1, len(poly) - 1):     # 扇形三角化
                faces.append((poly[0], poly[t], poly[t + 1]))
            poly = []
    print(f'  三角面 {len(faces):,}')

    # UV 索引越界就说明 mapping/reference 判断错了，宁可报错也别产出一个坏 OBJ
    if UV is not None:
        mx = max(b for tri in faces for _, b in tri)
        if mx >= nUV:
            raise SystemExit(
                f'UV 索引越界：最大 {mx}，但只有 {nUV} 个 UV。'
                f'（mapping={mapping!r} reference={ref!r} UVIndex={"有" if UVI else "无"}）')
        print(f'  UV 索引检查通过（最大 {mx:,} < {nUV:,}）')

    print('[fbx2obj] 写 OBJ ...')
    base = os.path.splitext(os.path.basename(dst))[0]
    with open(dst, 'w') as f:
        f.write('# 由 tools/fbx2obj.py 从 FBX 抽出\n')
        if tex:
            f.write(f'mtllib {base}.mtl\n')
        f.write(f'o {base}\n')
        for i in range(0, len(V), 3):
            f.write(f'v {V[i]:.6f} {V[i+1]:.6f} {V[i+2]:.6f}\n')
        if UV is not None:
            for i in range(0, len(UV), 2):
                f.write(f'vt {UV[i]:.6f} {UV[i+1]:.6f}\n')
        if tex:
            f.write(f'usemtl {base}\n')
        for tri in faces:
            if UV is not None:
                f.write('f ' + ' '.join(f'{a+1}/{b+1}' for a, b in tri) + '\n')
            else:
                f.write('f ' + ' '.join(str(a + 1) for a, _ in tri) + '\n')

    if tex:
        with open(os.path.join(os.path.dirname(dst) or '.', base + '.mtl'), 'w') as f:
            f.write(f'newmtl {base}\nKa 1 1 1\nKd 1 1 1\nKs 0 0 0\nd 1\nillum 2\n')
            f.write(f'map_Kd {os.path.basename(tex)}\n')

    print(f'[fbx2obj] 完成: {dst}  ({os.path.getsize(dst)/1048576:.1f} MB)')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    main()
