# Coding Style

## Immutability (CRITICAL)

ALWAYS create new objects, NEVER mutate:

```javascript
// WRONG: Mutation
function updateUser(user, name) {
  user.name = name  // MUTATION!
  return user
}

// CORRECT: Immutability
function updateUser(user, name) {
  return {
    ...user,
    name
  }
}
```

## File Organization

MANY SMALL FILES > FEW LARGE FILES:
- High cohesion, low coupling
- 200-400 lines typical, 800 max
- Extract utilities from large components
- Organize by feature/domain, not by type

## Comments (CRITICAL)

コメントは「コードだけでは表現できない制約・理由」を次の読み手に伝えるためだけに書く。以下は**全面禁止**:

### 禁止 1: Issue / PR 番号・チケット参照

```typescript
// WRONG
/**
 * Issue #2479: vanilla-extract migration of legacy `styles/oco-overlay.css` →
 * co-located `PriceChart.css.ts`（押し目 OCO オーバーレイ #1589）。
 */
```

来歴は git log / PR / Issue が既に記録している。コードに書くのは二重管理であり、マージした瞬間からノイズ。`#1234` `Issue #` `PR #` をコメントに書かない。

### 禁止 2: 移行・変更の来歴語り

「元は X だった」「Y から移行した」「legacy Z を置き換えた」類の歴史記述は書かない。今のコードが何であるかだけが重要で、過去に何だったかは git が知っている。

### 禁止 3: 規約文書への参照・レビュー弁明

```typescript
// WRONG
/**
 * 規約: [`docs/STYLING.md`](../../../../docs/STYLING.md) §3 + CLAUDE.md「🚨 絶対禁止:
 * margin/padding での兄弟間隔」の双方に従う。元 CSS の `.qf-oco__legend {
 * margin-top: var(--qf-2) }` は兄弟間隔で禁止対象なので、Issue #2479 レビューで
 * 検出された違反を **親を `display: flex` に保ったまま `padding-top` に変換**。
 */
```

「この変更は規約に従っている」「レビュー指摘に対応した」という弁明はレビュアー向けの発話であり、コードの読み手には無意味。規約に従うのは当然でありコメントで宣言することではない。書きたければ PR の説明に書く。

### 書いてよいコメント

コードから読み取れない制約のみ:

```typescript
// CORRECT: 外部制約
// Yahoo API は 1 リクエスト 200 銘柄まで
const CHUNK_SIZE = 200

// CORRECT: 非自明な理由
// WAL モードでは INSERT で mtime が変わらないため手動 invalidate が必要
invalidateCompanyMap()
```

判定基準: **「このコメントは 1 年後の読み手の理解を助けるか、それとも今回のレビュアーへの説明か」**。後者なら削除。

## Error Handling

ALWAYS handle errors comprehensively:

```typescript
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  console.error('Operation failed:', error)
  throw new Error('Detailed user-friendly message')
}
```

## Input Validation

ALWAYS validate user input:

```typescript
import { z } from 'zod'

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150)
})

const validated = schema.parse(input)
```

## Code Quality Checklist

Before marking work complete:
- [ ] Code is readable and well-named
- [ ] Functions are small (<50 lines)
- [ ] Files are focused (<800 lines)
- [ ] No deep nesting (>4 levels)
- [ ] Proper error handling
- [ ] No console.log statements
- [ ] No hardcoded values
- [ ] No mutation (immutable patterns used)
