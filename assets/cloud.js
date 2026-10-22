/* 云服务接入：客户端初始化 + 战绩存取 */
(function () {
  const TABLE = 'ww_matches';

  const Cloud = {
    client: null,
    ready: false,
    error: '',

    init() {
      try {
        if (!window.WorkBuddyCloud || !window.WorkBuddyCloud.createWorkBuddyCloud) {
          this.error = 'SDK 未加载';
          return false;
        }
        const cfg = window.PUBLIC_CONFIG;
        this.client = window.WorkBuddyCloud.createWorkBuddyCloud({
          endpoint: cfg.endpoint,
          oauthRelayBaseUrl: cfg.oauthRelayBaseUrl,
          publishableKey: cfg.publishableKey
        });
        this.ready = true;
        return true;
      } catch (e) {
        this.error = e && e.message ? e.message : String(e);
        return false;
      }
    },

    /* 保存一局战绩 */
    async saveMatch(row) {
      if (!this.ready) return { ok: false, error: '云服务未连接' };
      try {
        const { data, error } = await this.client.database
          .from(TABLE)
          .insert({
            player_name: row.playerName || '匿名玩家',
            player_role: row.playerRole || '',
            result: row.result || '',
            rounds: row.rounds || 0,
            survivors: row.survivors || 0,
            detail: row.detail || {}
          })
          .select('id')
          .single();
        if (error) throw error;
        return { ok: true, id: data && data.id };
      } catch (e) {
        return { ok: false, error: (e && e.message) || '写入失败' };
      }
    },

    /* 最近对局（公开读取） */
    async recent(limit) {
      if (!this.ready) return { ok: false, rows: [], error: '云服务未连接' };
      try {
        const { data, error } = await this.client.database
          .from(TABLE)
          .select('id,player_name,player_role,result,rounds,created_at')
          .order('created_at', { ascending: false })
          .limit(limit || 8);
        if (error) throw error;
        return { ok: true, rows: data || [] };
      } catch (e) {
        return { ok: false, rows: [], error: (e && e.message) || '读取失败' };
      }
    },

    /* 总数与阵营胜率 */
    async stats() {
      if (!this.ready) return null;
      try {
        const { data, count, error } = await this.client.database
          .from(TABLE)
          .select('result', { count: 'exact' })
          .limit(200);
        if (error) throw error;
        const rows = data || [];
        const good = rows.filter(r => r.result === 'good').length;
        const wolf = rows.filter(r => r.result === 'wolf').length;
        const total = typeof count === 'number' ? count : rows.length;
        return { total, good, wolf };
      } catch (e) {
        return null;
      }
    }
  };

  window.Cloud = Cloud;
})();
