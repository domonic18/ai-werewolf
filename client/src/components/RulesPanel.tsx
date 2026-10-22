const RULES = [
  { emoji: '🐺', title: '狼人 ×2', desc: '每晚刀一人，白天装好人' },
  { emoji: '🔮', title: '预言家 ×1', desc: '每晚验一人，知道好坏' },
  { emoji: '🧪', title: '女巫 ×1', desc: '一瓶解药一瓶毒药，各一次' },
  { emoji: '🧑‍🌾', title: '平民 ×2', desc: '没有技能，只有嘴和票' },
];

export function RulesPanel(): JSX.Element {
  return (
    <div className="panel rules">
      <div className="panel-title">身份与胜负</div>
      <div className="rule-grid">
        {RULES.map((rule) => (
          <div key={rule.title} className="rule">
            <span className="re">{rule.emoji}</span>
            <b>{rule.title}</b>
            <i>{rule.desc}</i>
          </div>
        ))}
      </div>
      <p className="hint">狼人全部出局 → 好人胜；狼人数 ≥ 好人数 → 狼人胜。共 6 人，你随机拿一个身份。</p>
    </div>
  );
}
