// 可操控的动物。按 Q 轮换。
//
// 每种的手感要真的不一样，不能只是换个皮：
//   walk/run  基础速度
//   accel     速度跟随的快慢，越大起步越干脆
//   jump      [起跳基数, 速度加成] —— 实际力度 = 基数 + 加成 × (当前速度 / run)
//   stance    默认姿态，0 四足 1 直立
//
// 梦境那条河的地面缺口是 5.6 米，三种全速跑跳都过得去（9.4 / 13.7 / 10.5 米）。

export const PLAYABLE = [
  {
    id: 'niulai', model: 'niulai', name: '牛来', kind: '初生牛犊',
    height: 1.25, girth: 1.0, stance: 0.1, tint: 0xfff0c4,
    walk: 4.6, run: 8.2, accel: 9, jump: [4.8, 3.2], voice: 'niulai',
    line: '牛妈喊「牛，来」，喊到他站起来。名字就是这么得的。',
    note: '跑得一般，跳得一般。',
  },
  {
    // 牛妈也能玩。跳的时候她喊的是「牛来」——跟牛来喊「妈妈」正好对上。
    id: 'mother', model: 'niulai', name: '牛妈', kind: '',
    height: 1.85, girth: 1.2, stance: 0.1, tint: 0xffeec6,
    walk: 4.4, run: 7.6, accel: 7, jump: [4.6, 2.9], voice: 'mother',
    line: '给牛来取名字的那位。喊「牛，来」，喊到他站起来。',
    note: '大个子，起步慢，但跨得开。',
  },
  {
    id: 'baola', model: 'baola', name: '豹拉', kind: '豹子',
    height: 1.15, girth: 1.0, stance: 0.85, tint: 0xffffff,
    walk: 5.6, run: 10.4, accel: 13, jump: [5.4, 3.8], voice: 'baola',
    line: '装饿讨到一口奶的那只。牛妈看了它很久，最后点了头。',
    note: '跑得最快，跳得最远。',
  },
  {
    // 这个模型是真四足，本身就有正确的体态，
    // stance 给高一点让挤压拉伸接近中性，别再把它拉长
    id: 'dog', model: 'dog', name: '狗', kind: '狗',
    height: 0.82, girth: 1.0, stance: 0.72, tint: 0xffffff,
    walk: 5.2, run: 9.2, accel: 17, jump: [5.0, 3.0], voice: 'dog',
    // 影片里这条狗的情节我没查到，所以不编，只写手感
    line: null,
    note: '起步和刹车最快，跳不算高。',
  },
  {
    // 云雀。小、轻、跳得极高——毕竟是只鸟，只是这游戏里它得落地。
    id: 'bird', model: 'bird', name: '云雀', kind: '',
    height: 0.45, girth: 1.0, stance: 0.9, tint: 0xffffff,
    walk: 4.8, run: 7.4, accel: 20, jump: [5.2, 2.4], voice: 'lark',
    gravity: 7.5,
    // 长按跳跃键就一直扑翼往上飞，松手滑翔下降
    fly: { accel: 20, maxUp: 4.0, ceiling: 15 },
    line: '从荒漠飞来，落在牛来背上，被一起带进了梦里。',
    note: '最轻，转向最快。按住跳跃键就一直往上飞。',
    hint: '按住空格 / 长按「飞」——一直扑翼往上',
  },
];

export const byId = (id) => PLAYABLE.find((a) => a.id === id) ?? PLAYABLE[0];

// 视角。按 V 轮换。
export const VIEWS = [
  { id: 'third', name: '第三人称', dist: 9, pitch: 0.24 },
  { id: 'shoulder', name: '肩后近景', dist: 4.6, pitch: 0.16, side: 0.75 },
  { id: 'first', name: '第一人称', dist: 0, pitch: 0.1 },
];
