/**
 * 角色定义与对局常量
 * 全局唯一的身份配置来源，前后端共用语义（前端仅消费展示字段）。
 */
const ROLES = {
  wolf:     { key: 'wolf',     name: '狼人',   emoji: '🐺', team: 'wolf' },
  seer:     { key: 'seer',     name: '预言家', emoji: '🔮', team: 'good' },
  witch:    { key: 'witch',    name: '女巫',   emoji: '🧪', team: 'good' },
  villager: { key: 'villager', name: '平民',   emoji: '🧑‍🌾', team: 'good' }
};

/** 6 人局固定配置：狼2 / 预言家1 / 女巫1 / 平民2 */
const ROLE_DECK = ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'];

/** AI 补位角色池（名字/形象/性格 prompt 人设） */
const AI_CAST = [
  { name: '老K', emoji: '🕶️', persona: '沉稳老练，说话短促，喜欢抓别人话里的逻辑漏洞' },
  { name: '小满', emoji: '🍊', persona: '热情话多，爱打比方，容易冲动站边' },
  { name: '阿岚', emoji: '🧊', persona: '冷静理性，爱讲概率和可能性，句子像简报' },
  { name: '豆豆', emoji: '🍬', persona: '新手感，语气软，凭直觉说话但经常意外地准' },
  { name: '七喜', emoji: '🎭', persona: '阴阳怪气，爱反讽拱火，喜欢逼人表态' }
];

const GAME_RULES = {
  minPlayers: 6,
  maxRounds: 8,
  humanPlayerName: '你'
};

/** 胜负判定：狼人全灭 → 好人胜；狼人数 ≥ 好数 → 狼人胜 */
function judgeWinner(alivePlayers) {
  const wolves = alivePlayers.filter(p => p.role === 'wolf').length;
  const goods = alivePlayers.length - wolves;
  if (wolves === 0) return 'good';
  if (wolves >= goods) return 'wolf';
  return null;
}

module.exports = { ROLES, ROLE_DECK, AI_CAST, GAME_RULES, judgeWinner };
