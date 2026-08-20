# 外部语音插槽

游戏默认用 Web Audio 现场合成叫声（见 `src/audio/synth.js`）。
目录里放了文件并在 `manifest.json` 登记后，就会覆盖同名的合成音。

> ⚠️ **当前 `niulai.mp3` / `mother.mp3` / `baola.mp3` 是影片片段，只供本机跑，不要随包分发。**
> 详见文末「当前素材状态」与「版权」。

想换成自己的素材，把音频文件放进这个目录，然后在 `manifest.json` 里登记：

```json
{
  "niulai": "niulai.mp3",
  "mother": "mother.mp3",
  "father": "father.wav",
  "baola":  "baola.ogg"
}
```

登记过的角色会用文件，没登记的继续用合成音。文件读不到就安静跳过，不会报错。

可用的角色 id：

| id | 角色 | 触发时机 |
|---|---|---|
| `niulai` | 牛来 | 按 `Z`；起跳时也会带一声 |
| `mother` | 妈妈 | 按 `X` |
| `baola` | 豹拉 | 按 `C` |
| `father` | 爸爸 | 对话中他说话时 |
| `niuer` | 牛二 | 对话中他说话时 |
| `snake` | 灵蛇 | 对话中它说话时 |
| `lark` | 云雀 | 对话中它出声时 |
| `wolf` | 狼 | 对话中它说话时 |

格式用浏览器能解的就行（mp3 / ogg / wav / m4a）。单个文件建议控制在几百 KB 以内，
它们会被打进 `dist/`。

## 喊妈妈 / 回应

跳跃和按 `Z` 都会让牛来喊一声（取录音最响处的 0.6 秒，读起来像喊不像哞），
**妈妈在场时**隔 700ms 回一声。在不在场由每个场景的 `motherNear(flags)` 决定：

| 场景 | 会回应 |
|---|---|
| 草原 | ✓ 她就站在那儿 |
| 梦·草丛 / 梦·林子 | — 她不在梦里这两段 |
| 梦·迁徙 · 她出现前 | — |
| 梦·迁徙 · 追逐中 | ✓ |
| 梦·迁徙 · 她走之后 | **— 喊了没人应** |
| 醒来 | ✓ 牛爸说她在前头吃草 |

回应有 1.5 秒冷却，连着跳不会叠成一片。

## 当前素材状态

| 文件 | 来源 | 可否分发 |
|---|---|---|
| `niulai.mp3` | 影片片段：牛来喊"妈妈"（BV1wBbC6MEDU 的 23.0–25.4s，响度归一到 -16 LUFS） | ❌ **不可** |
| `mother.mp3` | 影片片段：妈妈喊"牛来"（BV16Ub16MEKa 纯享循环单声，0.4s） | ❌ **不可** |
| `baola.mp3` | 影片片段："我不是绳头，我是豹啦"名场面（BV14vbe6EEvg 的 66.4–69.2s） | ❌ **不可** |
| `niuer.mp3` `father.mp3` `dog.mp3` `wolf.mp3` | Wikimedia CC 素材，见下表 | ✅ 按 CC 条款署名即可 |
| `niulai.cc.bak.mp3` `mother.cc.bak.mp3` | 被替换掉的 CC 版本，留着备份 | ✅ |

**这两个影片片段是本机开发/自己玩用的。** 想恢复成全部可分发的版本：

```bash
cd game/public/voice && cp niulai.cc.bak.mp3 niulai.mp3 && cp mother.cc.bak.mp3 mother.mp3
```

小红书小工具包**不受影响**：容器不允许 `.mp3` 这个文件类型，而且 `loadOverrides` 整段被
`__MINITOOL__` 编译掉，`dist-minitool/` 里不会出现任何语音文件，那一版全走合成音。

## 素材来源（CC 部分）

下表是 CC 素材的来源（含已被影片片段替换、仅存备份的牛来/妈妈/豹拉 CC 版）。
牛族的 CC 版声音均源自同一段真实牛叫录音的不同变调（ffmpeg asetrate/atempo）：

| 文件 | 角色 | 源素材 | 作者 | 许可证 | 处理 |
|---|---|---|---|---|---|
| `niulai.cc.bak.mp3` | 牛来（已被影片片段替换） | [Mudchute cow 1.ogg](https://commons.wikimedia.org/wiki/File:Mudchute_cow_1.ogg) | Secretlondon | CC BY-SA 3.0 | 升约 5 个半音、响度归一 |
| `niuer.mp3` | 牛二 | 同上 | Secretlondon | CC BY-SA 3.0 | 升约 2.5 个半音 |
| `mother.cc.bak.mp3` | 妈妈（已被影片片段替换） | 同上 | Secretlondon | CC BY-SA 3.0 | 降约 2 个半音 |
| `father.mp3` | 爸爸 | 同上 | Secretlondon | CC BY-SA 3.0 | 降约 4 个半音 |
| —（未留备份） | 豹拉（已被影片片段替换） | [Jaguar saw.flac](https://commons.wikimedia.org/wiki/File:Jaguar_saw.flac) | About Zoos | CC BY 4.0 | 响度归一；需要时按此源重新生成 |
| `dog.mp3` | 狗 | [Barking of a dog.ogg](https://commons.wikimedia.org/wiki/File:Barking_of_a_dog.ogg) | Amada44 | CC BY-SA 3.0 | 截首尾、归一 |
| `wolf.mp3` | 狼 | [Jem howls.ogg](https://commons.wikimedia.org/wiki/File:Jem_howls.ogg) | amethysta | 公有领域 | 截段、归一 |

署名要求：按 CC BY / CC BY-SA 条款，上表即为署名，随 `dist/` 一起分发即可；
BY-SA 素材的演绎版本（变调文件）继续以相同许可证发布。
`snake` / `lark` 没有合适素材，继续用合成音。

⚠️ 排雷记录：Commons 上的 `Single Cow Moo.ogg` 实为商业音效库 Sound Ideas 的切片、
授权存疑，已弃用；`Cow in Vezo.ogg` / `Cow in Antefasy.wav` 是语言发音文件不是牛叫，勿用。

## 版权

⚠️ `niulai.mp3` / `mother.mp3` / `baola.mp3` 是从 B 站屏摄剪辑里提取的电影台词，
**未获授权**。片中配音是导演信雨萌和编剧孙丽芳本人的声音。项目作者已知情并决定
以非商业同人致敬的名义使用这几秒片段，风险自担；一旦权利人提出异议，应立即从
本目录和 `dist/` 中移除并回退到合成音（删掉 manifest.json 里对应行即可）。

其余动物录音来自 Wikimedia Commons 自由许可素材，署名见上表，随 `dist/` 分发即合规。
