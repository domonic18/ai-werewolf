/**
 * 云数据库封装：战绩存取（PostgREST 风格，supabase 兼容）。
 * 表 ww_matches 由部署前 migrate 创建（见 README「云资源」）。
 */
const TABLE = 'ww_matches';

class MatchStore {
  constructor(cloudClient) {
    this.db = cloudClient ? cloudClient.database : null;
  }

  async save(row) {
    if (!this.db) return { ok: false, error: 'cloud-not-initialized' };
    const { data, error } = await this.db.from(TABLE).insert({
      player_name: row.playerName || '匿名玩家',
      player_role: row.playerRole || '',
      result: row.result || '',
      rounds: row.rounds || 0,
      survivors: row.survivors || 0,
      detail: row.detail || {}
    }).select('id').single();
    if (error) return { ok: false, error: error.message || String(error) };
    return { ok: true, id: data && data.id };
  }

  async recent(limit = 8) {
    if (!this.db) return { ok: false, rows: [] };
    const { data, error } = await this.db.from(TABLE)
      .select('id,player_name,player_role,result,rounds,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { ok: false, rows: [] };
    return { ok: true, rows: data || [] };
  }

  async stats() {
    if (!this.db) return null;
    const { data, error } = await this.db.from(TABLE).select('result').limit(200);
    if (error) return null;
    const rows = data || [];
    return {
      total: rows.length,
      good: rows.filter(r => r.result === 'good').length,
      wolf: rows.filter(r => r.result === 'wolf').length
    };
  }
}

module.exports = { MatchStore, MATCH_TABLE: TABLE };
