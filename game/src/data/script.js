// 《牛来》剧本
//
// ⚠️ 这一版做过一次订正。之前的对白大半是自己编的（牛二的爷爷、狼有三个孩子、
// 爸爸要挪窝三里地、云飘到荒漠就散了……），跟电影对不上。现在的原则是：
// **只承载查证到的情节点，不再添加电影里没有的人物关系、往事和设定。**
//
// 有据可查的（来源见 README「出处」）：
//   · 牛来刚出生趴在地上站不起来，牛妈为鼓励它站起来，给它取名"牛来"
//   · 云雀从荒漠飞来，牛来把它带进梦乡；梦境是全片框架，云雀是见证者
//   · 牛来玩耍时碰到蛇，因为眼神不好，以为是一截会动的绳子头
//   · 牛来顺着一个果子找到小豹子豹拉；确认是豹不是毒蛇后松一口气
//   · 豹拉佯装饥饿索要牛奶，牛妈最终同意
//   · 森林是"被邪恶人类破坏"的地点
//   · 狼群袭击，牛群被迫迁徙，途中牛妈为保护牛来牺牲
//   · 醒来，发现一切是梦，与父亲的牛群团聚
//   · 灵蛇的告诫，官方与百科的说法是"世间从无安稳"
//
// 台词本身仍是改编，不是原片原文——原片对白未公开，也不该照搬。
// 所以写得尽量短，只把上面这些点说清楚，不铺开。

export const SCENES = ['prairie', 'deep', 'forest', 'desert', 'reunion'];

export const SCENE_TITLES = {
  prairie: { cn: '草原', sub: '第一章　站起来' },
  deep: { cn: '梦·草丛', sub: '第二章　一截会动的绳子' },
  forest: { cn: '梦·林子', sub: '第三章　果子和奶' },
  desert: { cn: '梦·迁徙', sub: '第四章　狼来了' },
  reunion: { cn: '醒来', sub: '终章　原来是梦' },
};

// node = { lines: [{who, text}], choices?: [{text, to}], to?: 'next' | null, flag?, trigger? }

export const DIALOGUES = {
  // ============================================================ 第一章
  // 有据：名字的来历。
  mother: {
    name: '牛妈',
    color: '#e6cfa0',
    start: {
      lines: [
        { who: '牛妈', text: '牛来。' },
        { who: '牛来', text: '哎。' },
        { who: '牛妈', text: '你刚生下来那天，趴在地上，怎么都起不来。' },
      ],
      choices: [
        { text: '「后来呢？」', to: 'name' },
        { text: '「我不记得了。」', to: 'name' },
      ],
    },
    name: {
      lines: [
        { who: '牛妈', text: '我就在你耳边喊：牛，来。' },
        { who: '牛妈', text: '喊到你站起来为止。' },
        { who: '牛妈', text: '名字就是这么来的。' },
      ],
      to: null,
      flag: 'metMother',
    },
    // 反复找她说话时的闲聊。轮着说，不会一句翻来覆去。
    //
    // 这一组跟上面那段取名的正戏是分开的：正戏只写查得到的情节，
    // 这里是玩家自己反复搭话才会触发的段子，走的是"秋招 + 摆烂"那条线，
    // 跟滑铲、躺平的文案是一路的。
    repeat: [
      { lines: [
        { who: '牛妈', text: '你这个年纪不上班，晚上怎么睡得着觉的？' },
        { who: '牛来', text: '……趴下就睡着了。' },
        { who: '牛妈', text: '你还挺有理。' },
      ], to: null },
      { lines: [
        { who: '牛妈', text: '你看看东边坡上那头，人家秋天就定下来了。' },
        { who: '牛来', text: '它被套上犁了。' },
        { who: '牛妈', text: '……那也算有着落。' },
      ], to: null },
      { lines: [
        { who: '牛妈', text: '简历投了几家了？' },
        { who: '牛来', text: '我是一头牛。' },
        { who: '牛妈', text: '牛也要有牛的规划。' },
      ], to: null },
      { lines: [
        { who: '牛妈', text: '一天到晚在草里躺着，草都被你压出坑了。' },
        { who: '牛来', text: '那是我工位。' },
      ], to: null },
      { lines: [
        { who: '牛妈', text: '你舅家那头小的，秋招进了南边最大的那个牧场。' },
        { who: '牛来', text: '我知道。它现在一天挤三回。' },
        { who: '牛妈', text: '……' },
        { who: '牛妈', text: '那你少挤两回也行。' },
      ], to: null },
      { lines: [
        { who: '牛妈', text: '不问你了。' },
        { who: '牛妈', text: '去玩吧。别走远。' },
      ], to: null },
    ],
  },

  niuer: {
    name: '牛二',
    color: '#d8c07a',
    start: {
      lines: [
        { who: '牛二', text: '牛来。' },
        { who: '牛二', text: '你现在站得挺稳。' },
        { who: '牛来', text: '嗯。' },
      ],
      to: null,
    },
    repeat: {
      lines: [{ who: '牛二', text: '走了走了，去那边。' }],
      to: null,
    },
  },

  // 有据：云雀从荒漠飞来，被牛来带进梦乡。
  lark_intro: {
    name: '云雀',
    color: '#cfd8e6',
    start: {
      lines: [
        { who: '旁白', text: '一只鸟落在牛来背上。羽毛上还带着沙。' },
        { who: '牛来', text: '你从荒漠那边来的？' },
        { who: '云雀', text: '（它没有走的意思。）' },
      ],
      choices: [
        { text: '「那今晚就待着吧。」', to: 'sleep' },
      ],
    },
    sleep: {
      lines: [
        { who: '旁白', text: '牛来闭上眼睛。' },
        { who: '旁白', text: '这只鸟，被他一起带进了梦里。' },
      ],
      to: null,
      flag: 'metLark',
    },
  },

  // ============================================================ 第二章
  // 有据：牛来眼神不好，把蛇看成一截会动的绳子头。
  snake: {
    name: '灵蛇',
    color: '#8fbf9f',
    start: {
      lines: [
        { who: '旁白', text: '草里有一截绳子头。' },
        { who: '旁白', text: '它在动。' },
        { who: '牛来', text: '……这绳子怎么自己会动？' },
      ],
      choices: [
        { text: '（凑过去看）', to: 'oops' },
        { text: '（用蹄子碰一碰）', to: 'oops' },
      ],
    },
    oops: {
      lines: [
        { who: '灵蛇', text: '我不是绳子。' },
        { who: '牛来', text: '啊！' },
        { who: '灵蛇', text: '你眼神不好。' },
      ],
      to: 'warn',
    },
    warn: {
      lines: [
        { who: '灵蛇', text: '记一句话。' },
        { who: '灵蛇', text: '世间从无安稳。' },
        { who: '旁白', text: '草面上留下一道很长的、慢慢合拢的缝。' },
      ],
      to: null,
      flag: 'metSnake',
    },
    repeat: {
      lines: [{ who: '灵蛇', text: '往前走。' }],
      to: null,
    },
  },

  // ============================================================ 第三章
  // 有据：顺着果子找到豹拉；先当成毒蛇，认出是豹后松一口气；豹拉佯装饥饿讨奶。
  baola: {
    name: '豹拉',
    color: '#e0a94b',
    start: {
      lines: [
        { who: '旁白', text: '一个果子从坡上滚下来，牛来顺着它找过去。' },
        { who: '旁白', text: '草里有一身斑纹。' },
        { who: '牛来', text: '蛇——！' },
        { who: '豹拉', text: '我是豹。' },
        { who: '牛来', text: '……吓死我了。' },
      ],
      choices: [
        { text: '「你在这儿干什么？」', to: 'milk' },
        { text: '「豹也吃果子？」', to: 'milk' },
      ],
    },
    milk: {
      lines: [
        { who: '豹拉', text: '（往下一坐）我饿了。' },
        { who: '豹拉', text: '好几天没吃东西了。' },
        { who: '牛来', text: '……你刚才跑得挺快的。' },
        { who: '豹拉', text: '那是回光返照。' },
      ],
      choices: [
        { text: '「我去问我妈。」', to: 'shared' },
        { text: '「你装的吧。」', to: 'shared' },
      ],
    },
    shared: {
      lines: [
        { who: '旁白', text: '牛妈看了它很久。' },
        { who: '旁白', text: '最后点了头。' },
        { who: '豹拉', text: '（喝完了，抹嘴）我们算朋友了吧。' },
      ],
      to: null,
      flag: 'metBaola',
    },
    repeat: {
      lines: [{ who: '豹拉', text: '还有吗？' }],
      to: null,
    },
  },

  // 有据：森林是被人破坏的地点。只作陈述，不展开。
  stump: {
    name: '断树桩',
    color: '#9c7b52',
    start: {
      lines: [
        { who: '旁白', text: '一截锯断的树桩。切口很平。' },
        { who: '旁白', text: '这样的树桩，这片林子里到处都是。' },
      ],
      to: null,
    },
  },

  // ============================================================ 第四章
  // 有据：狼群袭击 → 牛群被迫迁徙 → 途中牛妈为保护牛来牺牲。
  wolf: {
    name: '狼',
    color: '#7f8a99',
    start: {
      lines: [
        { who: '旁白', text: '风里有味道。' },
        { who: '狼', text: '小的。' },
        { who: '狼', text: '你落单了。' },
      ],
      choices: [
        { text: '「我妈就在前面。」', to: 'attack' },
        { text: '（后退一步）', to: 'attack' },
      ],
    },
    attack: {
      lines: [
        { who: '旁白', text: '沙丘后面站起来第二只、第三只。' },
        { who: '旁白', text: '牛群开始跑。' },
      ],
      to: null,
      flag: 'wolfMet',
      trigger: 'chase',
    },
  },

  mother_end: {
    name: '牛妈',
    color: '#e6cfa0',
    start: {
      lines: [
        { who: '牛妈', text: '牛来，往前跑。' },
        { who: '牛来', text: '妈——' },
        { who: '牛妈', text: '别回头。' },
      ],
      choices: [
        { text: '（跑）', to: 'final' },
      ],
    },
    final: {
      lines: [
        { who: '旁白', text: '牛来跑了。' },
        { who: '旁白', text: '他没有回头。' },
      ],
      to: null,
      flag: 'motherGone',
      trigger: 'wake',
    },
  },

  // ============================================================ 终章
  // 有据：醒来发现是梦；与父亲的牛群团聚。
  father: {
    name: '牛爸',
    color: '#c9a86a',
    start: {
      lines: [
        { who: '旁白', text: '牛来睁开眼。' },
        { who: '旁白', text: '云雀还在背上，一夜没动。' },
        { who: '牛爸', text: '醒了？你睡觉一直在蹬腿。' },
      ],
      choices: [
        { text: '「妈呢？」', to: 'mom' },
        { text: '「我做了个梦。」', to: 'mom' },
      ],
    },
    mom: {
      lines: [
        { who: '牛爸', text: '在前头吃草。' },
        { who: '旁白', text: '牛来往前看。' },
        { who: '旁白', text: '牛妈就在那儿，好好的。' },
        { who: '牛来', text: '……' },
      ],
      to: 'end',
    },
    end: {
      lines: [
        { who: '牛爸', text: '走吧，跟上群。' },
        { who: '旁白', text: '背上的云雀展开翅膀，朝荒漠飞去。' },
        { who: '旁白', text: '牛来抬头看了一眼，然后跟着牛群往前走。' },
      ],
      to: null,
      flag: 'ending',
      trigger: 'finish',
    },
  },

  niuer_end: {
    name: '牛二',
    color: '#d8c07a',
    start: {
      lines: [
        { who: '牛二', text: '你今天起得早。' },
        { who: '牛来', text: '嗯。' },
      ],
      to: null,
    },
  },
};

// ---------------------------------------------------------------- 收集物
// 云雀掉的羽毛。写成中性的场景观察，不再借羽毛塞设定。
export const FEATHER_NOTES = {
  prairie: '一根带沙的羽毛。',
  deep: '一根羽毛，压在一张空蛇蜕下面。',
  forest: '一根羽毛，挂在锯断的切口上。',
  desert: '一根羽毛，半埋在沙里。',
  reunion: '最后一根。云雀飞走时落下的。',
};
