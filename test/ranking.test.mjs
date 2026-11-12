// categories + ranking 单测：24 分类匹配（最长词优先）、推荐算法、日期规则、互动排序、字段提取、moreHint
import test from 'node:test'
import assert from 'node:assert/strict'
import { matchCategory, suggestCategories, ALL_CATEGORIES } from '../lib/categories.js'
import { parseCount, formatNum, getQueryDate, extractArticles, sortArticles, interactionScore, extractNote, moreHint } from '../lib/ranking.js'

test('matchCategory：命中与最长词优先', () => {
  assert.equal(matchCategory('睫毛膏'), '化妆美容')
  assert.equal(matchCategory('洗浴中心'), null) // 上游示例：未命中
  assert.equal(matchCategory('旅游攻略'), '旅行度假') // 长词优先，不落入出行代步的"旅游"
  assert.equal(matchCategory('动漫'), '影视娱乐')
  assert.equal(matchCategory('洗护用品'), '个人护理')
  assert.equal(matchCategory('综合'), '综合全部')
  assert.equal(matchCategory(''), null)
  assert.equal(matchCategory(null), null)
})

test('ALL_CATEGORIES：24 个分类', () => {
  assert.equal(ALL_CATEGORIES.length, 24)
  assert.ok(ALL_CATEGORIES.includes('综合全部'))
  assert.ok(ALL_CATEGORIES.includes('化妆美容'))
})

test('suggestCategories：强相关不强凑、降序', () => {
  const s1 = suggestCategories('美妆教程') // "美妆"命中化妆美容
  assert.ok(s1.includes('化妆美容'))
  assert.ok(s1.length >= 1 && s1.length <= 3)
  // 强相关排在前
  const s2 = suggestCategories('穿搭')
  assert.equal(s2[0], '时尚穿搭')
  assert.ok(s2.length <= 3)
})

test('parseCount / formatNum：w+ 与万位', () => {
  assert.equal(parseCount('2w+'), 20000)
  assert.equal(parseCount('3.5w'), 35000)
  assert.equal(parseCount('893'), 893)
  assert.equal(parseCount(120000), 120000)
  assert.equal(parseCount('abc'), 0)
  assert.equal(parseCount(undefined), 0)
  assert.equal(formatNum(22300), '2w+')
  assert.equal(formatNum(9999), '9999')
  assert.equal(formatNum('10000'), '1w+')
})

test('getQueryDate：19:00 规则', () => {
  // 20:00 → 昨日
  const evening = new Date('2026-11-12T20:00:00')
  const r1 = getQueryDate(null, evening)
  assert.equal(r1.date, '2026-11-11')
  assert.equal(r1.auto, true)
  // 10:00 → 前天
  const morning = new Date('2026-11-12T10:00:00')
  const r2 = getQueryDate(null, morning)
  assert.equal(r2.date, '2026-11-10')
  // 指定日期直用
  const r3 = getQueryDate('2026-04-15', evening)
  assert.equal(r3.date, '2026-04-15')
  assert.equal(r3.auto, false)
})

test('extractArticles：多形态包装', () => {
  assert.deepEqual(extractArticles({ data: [1, 2] }), [1, 2])
  assert.deepEqual(extractArticles({ data: { list: [3] } }), [3])
  assert.deepEqual(extractArticles({ data: { records: [4] } }), [4])
  assert.deepEqual(extractArticles([5]), [5])
  assert.deepEqual(extractArticles({}), [])
  assert.deepEqual(extractArticles(null), [])
})

const mk = (ic, like, col, com, share) => ({ anaAdd: { interactiveCount: ic, useLikeCount: like, collectedCount: col, useCommentCount: com, useShareCount: share } })

test('interactionScore / sortArticles：互动优先与备用公式', () => {
  assert.equal(interactionScore(mk('2w+', 0, 0, 0, 0)), 20000)
  // 备用：100 + 50*2 + 30*3 + 10*5 = 340
  assert.equal(interactionScore(mk(0, 100, 50, 30, 10)), 340)
  const sorted = sortArticles([mk(100, 0, 0, 0, 0), mk('5w', 0, 0, 0, 0), mk(1000, 0, 0, 0, 0)], 2)
  assert.equal(sorted.length, 2)
  assert.equal(interactionScore(sorted[0]), 50000)
})

test('extractNote：anaAdd 字段映射（含上游真实拼写保留）', () => {
  const n = extractNote({
    title: '爆款标题', userName: '博主甲', fans: '1.2w', photoJumpUrl: 'https://xhslink.com/a b',
    anaAdd: {
      interactiveCount: '5w+', addInteractiveount: '2w+', // 上游拼写字段
      useLikeCount: '3w', addLikeCount: 1000,
      useCommentCount: 893, addCommentCount: 100,
      collectedCount: '1w', addCollectedCunt: 500, // 上游拼写字段
      useShareCount: 800, addShareCount: 50,
    },
  }, 0)
  assert.equal(n.rank, 1)
  assert.equal(n.interactive.add, '2w+')
  assert.equal(n.collected.add, 500)
  assert.equal(n.like.total, '3w')
  assert.equal(n.share.total, 800)
  assert.equal(n.photoJumpUrl, 'https://xhslink.com/a%20b') // 空格编码
})

test('moreHint：≤20 无提示 / >20 剩余数 / =50 固定 30', () => {
  assert.equal(moreHint(15), '')
  assert.equal(moreHint(20), '')
  assert.equal(moreHint(30), '回复“查看更多”可看剩余10条！✨')
  assert.equal(moreHint(50), '回复“查看更多”可看剩余30条！✨')
})
