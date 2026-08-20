#!/usr/bin/env python3
"""把 FBX 二进制整棵树走一遍，回答一个问题：里面到底有没有骨骼。

判据（任一成立即为带骨骼的可蒙皮模型）：
  - Model 节点的子类型是 LimbNode / Limb / Root  → 骨头
  - Deformer 节点子类型 Skin / Cluster           → 蒙皮权重
  - Pose 节点子类型 BindPose                     → 绑定姿势
  - AnimationStack / AnimationCurve              → 动画
"""
import struct, sys, zlib
from collections import Counter

path = sys.argv[1] if len(sys.argv) > 1 else '牛来.fbx'
f = open(path, 'rb')
head = f.read(27)
if head[:20] != b'Kaydara FBX Binary  ':
    sys.exit('不是二进制 FBX')
VER = struct.unpack('<I', head[23:27])[0]
WIDE = VER >= 7500

def read_props(f, nprops):
    """读属性，只保留字符串和数值；数组只记长度，不解压。"""
    out = []
    for _ in range(nprops):
        t = f.read(1).decode('ascii', 'replace')
        if t == 'Y': out.append(struct.unpack('<h', f.read(2))[0])
        elif t == 'C': out.append(bool(f.read(1)[0]))
        elif t == 'I': out.append(struct.unpack('<i', f.read(4))[0])
        elif t == 'F': out.append(struct.unpack('<f', f.read(4))[0])
        elif t == 'D': out.append(struct.unpack('<d', f.read(8))[0])
        elif t == 'L': out.append(struct.unpack('<q', f.read(8))[0])
        elif t in 'fdlib':
            n, enc, clen = struct.unpack('<III', f.read(12))
            f.seek(clen, 1)
            out.append(f'<array {t} n={n}>')
        elif t in 'SR':
            n = struct.unpack('<I', f.read(4))[0]
            raw = f.read(n)
            out.append(raw.decode('utf8', 'replace') if t == 'S' else f'<raw {n}>')
        else:
            raise ValueError(f'未知属性类型 {t!r}')
    return out

kinds = Counter()      # 'Model::LimbNode' 这种
top = []
skin_clusters = 0
deformers = Counter()
poses = Counter()
anim = Counter()
geom_stats = {}

def walk(f, end, depth, parent):
    while f.tell() < end - (25 if WIDE else 13):
        pos = f.tell()
        if WIDE:
            e, nprops, plen = struct.unpack('<QQQ', f.read(24))
            nlen = f.read(1)[0]
        else:
            e, nprops, plen = struct.unpack('<III', f.read(12))
            nlen = f.read(1)[0]
        if e == 0:
            return
        name = f.read(nlen).decode('utf8', 'replace')
        props = read_props(f, nprops)
        sub = next((p for p in props if isinstance(p, str) and not p.startswith('<')), '')
        # FBX 里对象名形如 "Model::xxx"，第三个属性才是子类型
        subtype = props[2] if len(props) > 2 and isinstance(props[2], str) else ''

        if parent == 'Objects':
            kinds[f'{name}::{subtype}'] += 1
            if name == 'Deformer':
                deformers[subtype] += 1
            if name == 'Pose':
                poses[subtype] += 1
            if name.startswith('Animation'):
                anim[name] += 1
            if name == 'Geometry':
                geom_stats.setdefault(subtype, 0)
                geom_stats[subtype] += 1
        if depth == 0:
            top.append(name)

        if f.tell() < e:
            walk(f, e, depth + 1, name)
        f.seek(e)

f.seek(27)
walk(f, len(open(path, 'rb').read()), 0, None)

print(f'FBX 版本      : {VER}')
print(f'顶层节点      : {top}')
print()
print('Objects 里的对象（类型::子类型 → 个数）：')
for k, v in kinds.most_common():
    print(f'  {k:-<44} {v}')
print()

bone_kinds = [k for k in kinds if k.startswith('Model::') and
              any(b in k for b in ('LimbNode', 'Limb', 'Root'))]
verdict = []
if bone_kinds: verdict.append(f'骨头节点 {bone_kinds}')
if deformers:  verdict.append(f'Deformer {dict(deformers)}')
if poses:      verdict.append(f'Pose {dict(poses)}')
if anim:       verdict.append(f'动画 {dict(anim)}')

print('=' * 56)
if verdict:
    print('结论：有骨骼 / 蒙皮 / 动画 —— ' + '；'.join(verdict))
else:
    print('结论：没有任何骨头、没有蒙皮、没有绑定姿势、没有动画曲线。')
    print('      这是一个纯静态网格。')
print('=' * 56)
