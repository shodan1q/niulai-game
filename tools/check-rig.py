#!/usr/bin/env python3
"""查一个模型文件到底有没有骨骼。

用法:  python3 tools/check-rig.py <文件> [文件...]

支持 .fbx / .glb / .gltf / .obj / .stl / .3mf / .ply / .dae。
对存不了骨骼的格式直接说明是格式限制，不是文件的问题。
"""
import json, os, struct, sys, zipfile

# 这些格式在规范层面就没有骨骼/蒙皮的概念
NO_RIG_FORMATS = {
    '.obj': 'OBJ 只有顶点、UV、法线、面。规范里没有骨骼、没有蒙皮权重。',
    '.stl': 'STL 只有三角面，连顶点索引和颜色都没有。纯打印格式。',
    '.3mf': '3MF 是打印格式，存的是网格 + 材质 + 打印参数，没有骨骼。',
    '.ply': 'PLY 是点云/网格格式，没有骨骼。',
}


def check_fbx(path):
    with open(path, 'rb') as f:
        head = f.read(27)
        if head[:20] != b'Kaydara FBX Binary  ':
            return None, 'ASCII FBX 或非 FBX 文件，本脚本只解二进制 FBX'
        ver = struct.unpack('<I', head[23:27])[0]
        wide = ver >= 7500
        size = os.path.getsize(path)

        def read_props(f, n):
            out = []
            for _ in range(n):
                t = f.read(1).decode('ascii', 'replace')
                if t == 'Y': out.append(struct.unpack('<h', f.read(2))[0])
                elif t == 'C': out.append(bool(f.read(1)[0]))
                elif t == 'I': out.append(struct.unpack('<i', f.read(4))[0])
                elif t == 'F': out.append(struct.unpack('<f', f.read(4))[0])
                elif t == 'D': out.append(struct.unpack('<d', f.read(8))[0])
                elif t == 'L': out.append(struct.unpack('<q', f.read(8))[0])
                elif t in 'fdlib':
                    _n, _enc, clen = struct.unpack('<III', f.read(12))
                    f.seek(clen, 1); out.append(None)
                elif t in 'SR':
                    ln = struct.unpack('<I', f.read(4))[0]
                    raw = f.read(ln)
                    out.append(raw.decode('utf8', 'replace') if t == 'S' else None)
                else:
                    raise ValueError(f'未知属性类型 {t!r}')
            return out

        found = {'bones': [], 'deformers': [], 'poses': [], 'anims': [], 'meshes': 0}

        def walk(end, parent):
            while f.tell() < end - (25 if wide else 13):
                if wide:
                    e, nprops, _plen = struct.unpack('<QQQ', f.read(24)); nlen = f.read(1)[0]
                else:
                    e, nprops, _plen = struct.unpack('<III', f.read(12)); nlen = f.read(1)[0]
                if e == 0:
                    return
                name = f.read(nlen).decode('utf8', 'replace')
                props = read_props(f, nprops)
                sub = props[2] if len(props) > 2 and isinstance(props[2], str) else ''
                if parent == 'Objects':
                    if name == 'Model':
                        if sub in ('LimbNode', 'Limb', 'Root'): found['bones'].append(sub)
                        elif sub == 'Mesh': found['meshes'] += 1
                    elif name == 'Deformer': found['deformers'].append(sub)
                    elif name == 'Pose': found['poses'].append(sub)
                    elif name.startswith('Animation'): found['anims'].append(name)
                if f.tell() < e:
                    walk(e, name)
                f.seek(e)

        f.seek(27)
        walk(size, None)
        return found, None


def check_gltf(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.glb':
        with open(path, 'rb') as f:
            magic, _ver, _len = struct.unpack('<III', f.read(12))
            if magic != 0x46546C67:
                return None, '不是合法的 GLB（magic 不对）'
            clen, ctype = struct.unpack('<II', f.read(8))
            if ctype != 0x4E4F534A:
                return None, 'GLB 第一个 chunk 不是 JSON'
            js = json.loads(f.read(clen).decode('utf8'))
    else:
        with open(path, encoding='utf8') as f:
            js = json.load(f)

    skins = js.get('skins', [])
    joints = {j for s in skins for j in s.get('joints', [])}
    anims = js.get('animations', [])
    skinned = [m for m in js.get('nodes', []) if 'skin' in m]
    return {
        'bones': [f'joint#{j}' for j in sorted(joints)],
        'deformers': ['Skin'] * len(skins),
        'poses': ['inverseBindMatrices'] * sum(1 for s in skins if 'inverseBindMatrices' in s),
        'anims': [a.get('name') or 'animation' for a in anims],
        'meshes': len(js.get('meshes', [])),
        'skinned_nodes': len(skinned),
    }, None


def check_dae(path):
    with open(path, encoding='utf8', errors='replace') as f:
        txt = f.read()
    return {
        'bones': ['JOINT'] * txt.count('type="JOINT"'),
        'deformers': ['skin'] * txt.count('<skin '),
        'poses': [],
        'anims': ['animation'] * txt.count('<animation '),
        'meshes': txt.count('<mesh>'),
    }, None


def report(path):
    name = os.path.basename(path)
    print(f'\n{"=" * 60}\n{name}')
    if not os.path.exists(path):
        print('  文件不存在'); return
    print(f'  {os.path.getsize(path) / 1048576:.1f} MB')
    ext = os.path.splitext(path)[1].lower()

    if ext in NO_RIG_FORMATS:
        print(f'  ✗ 没有骨骼 —— {NO_RIG_FORMATS[ext]}')
        print('    这是格式限制。哪怕原模型绑好了骨骼，导成这个格式也会全部丢掉。')
        return

    if ext == '.zip':
        with zipfile.ZipFile(path) as z:
            inner = [n for n in z.namelist() if os.path.splitext(n)[1].lower()
                     in ('.fbx', '.glb', '.gltf', '.dae', '.obj', '.stl')]
        print(f'  压缩包，里面有: {inner or "没有模型文件"}')
        print('    先解压再查里面的文件。')
        return

    try:
        if ext == '.fbx': found, err = check_fbx(path)
        elif ext in ('.glb', '.gltf'): found, err = check_gltf(path)
        elif ext == '.dae': found, err = check_dae(path)
        else:
            print(f'  ? 不认识的扩展名 {ext}'); return
    except Exception as e:
        print(f'  解析失败: {type(e).__name__}: {e}'); return

    if err:
        print(f'  {err}'); return

    has = bool(found['bones'] or found['deformers'] or found['anims'])
    print(f'  网格 {found["meshes"]}　骨头 {len(found["bones"])}　'
          f'蒙皮 {len(found["deformers"])}　绑定姿势 {len(found["poses"])}　动画 {len(found["anims"])}')
    if has:
        print('  ✓ 有骨骼')
        if found['bones']: print(f'    骨头 {len(found["bones"])} 根')
        if found['deformers']: print(f'    蒙皮 {len(found["deformers"])} 个')
        if found['anims']: print(f'    动画: {found["anims"][:6]}')
        if not found['anims']:
            print('    注意：有骨架但没有动画曲线——能做程序化骨骼动画，但没有现成的走/跑循环。')
    else:
        print('  ✗ 没有骨骼，纯静态网格')


if __name__ == '__main__':
    files = sys.argv[1:]
    if not files:
        print(__doc__); sys.exit(1)
    for p in files:
        report(p)
    print(f'\n{"=" * 60}')
    print('要在游戏里用骨骼动画，导出格式必须是 FBX 或 GLB/glTF（推荐 GLB，three.js 原生支持）。')
    print('OBJ / STL / 3MF 一律会把骨架丢掉，文件名叫什么都没用。')
