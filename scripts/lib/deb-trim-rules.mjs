/**
 * scripts/lib/deb-trim-rules.mjs —— .deb 裁剪的回归断言规则（verify-deb.mjs 用）。
 *
 * 规则从 verify-deb.mjs 抽出来，唯一的理由是**可测**。这些正则作用在
 * `dpkg-deb -c` 列出的**真实条目**上，而条目里既有文件也有目录，目录条目带结尾
 * `/`：`.../node-pty/prebuilds/`。只按"文件路径"的直觉写，就会把这个由
 * after-pack 有意保留的容器目录判成泄漏——1.0.31 的 CI 正是这么挂的。
 * 反过来说，after-pack 侧的单元测试也救不了：它喂的是抽象文件路径，压根没有
 * "目录条目"这个形态。所以规则必须能拿真实条目形态来钉，见
 * scripts/__tests__/deb-trim-rules.test.ts。
 *
 * 注意正则与 after-pack.mjs 的 shouldExcludeWithinPackage 是一对：那边决定
 * "不进包"，这边断言"确实没进包"。改一边就得改另一边。
 */

/**
 * 不应出现在 .deb 里的东西。每条命中即失败。
 * `hint` 指向可能的失效点——断言失败时最想知道的是"去哪儿查"。
 */
export const TRIM_RULES = [
  {
    label: 'TypeScript 声明（*.d.ts / *.d.ts.map）',
    re: /\.d\.[cm]?ts(\.map)?$/,
    hint: 'shouldExcludeWithinPackage 未生效',
  },
  {
    label: 'TypeScript 构建缓存（*.tsbuildinfo）',
    re: /\.tsbuildinfo$/,
    hint: 'shouldExcludeWithinPackage 未生效',
  },
  {
    label: 'Windows 调试符号（*.pdb）',
    re: /\.pdb$/,
    hint: 'shouldExcludeWithinPackage 未生效',
  },
  {
    // 尾巴上的 `[^/]` 是这条规则的关键：`prebuilds/` 目录条目本身是**应该留着**的
    // （cpSync 必须能进这个目录，否则目标平台 prebuild 也一起没了），
    // 只写 `(?!linux-x64\/)` 的话目录条目（`prebuilds/` 之后为空串，负向前瞻通过）
    // 也会命中——1.0.31 CI 的假阳性就是这么来的。要求后随至少一个非 `/` 字符，
    // 目录条目与 `prebuilds/linux-x64/` 都落空，只有真实文件（`prebuilds/win32-x64/pty.node`
    // 或直接躺在 prebuilds/ 下的杂散文件）命中。
    label: 'node-pty 非目标平台 prebuild',
    re: /\/node-pty\/prebuilds\/(?!linux-x64\/)[^/]/,
    hint: 'node-pty 平台段判断失效',
  },
  {
    label: 'domino 测试夹具',
    re: /\/@mixmark-io\/domino\/test\//,
    hint: 'domino 排除规则失效',
  },
]

/**
 * 必须存在于 .deb 里的东西（反向断言）。裁剪误伤比裁剪失效更致命：
 * 少一个类型的 .d.ts 只是浪费体积，少一个 pty.node 是终端功能直接崩。
 */
export const KEEP_ASSERTIONS = [
  {
    label: 'node-pty 目标平台 prebuild',
    includes: '/node-pty/prebuilds/linux-x64/pty.node',
    hint: '缺 node-pty/prebuilds/linux-x64/pty.node——裁剪误伤目标平台 prebuild，终端功能将崩',
  },
]
