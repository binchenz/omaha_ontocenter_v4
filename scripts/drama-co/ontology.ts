import type { OntologySpec } from '../lib/ontology-bootstrap';

/**
 * drama_co 小说本体 — 带语义标注版 (ADR-0023)
 *
 * 这份本体源自开源清理 (c5d2e84) 前删除的 film-ai-v2-ontology-spec.ts，
 * 现重建并补全 description / unit 语义标注。标注的刻度/单位均经 RDS
 * (short_play_snail_data) 真实数据核验，不是臆测。
 *
 * 标注设计三原则（见 ADR-0023）：
 *   1. description 显式写出数值刻度（0-10 / 0-100 / 0-1），消除同义字段歧义
 *   2. 加"找 X 用此字段"导航句，直接引导 LLM 选字段
 *   3. 点明与兄弟字段的区别（张力三粒度、双评分刻度、节奏 vs 张力）
 *
 * 关键消歧组（本体最易翻车处）：
 *   - 张力三粒度同刻度(0-100): Book.avg_tension(书级均值) /
 *     ChapterSummary.emotionalTone(章级) / EmotionalCurvePoint.value(曲线点)
 *   - 双评分不同刻度: overall_score/adaptation_score(0-10) vs
 *     market_overall/MarketScore.score(0-100)
 *   - 节奏 vs 张力: ChapterSummary.pacingDensity(0-1 叙事快慢) 与
 *     emotionalTone(0-100 情绪张力) 不是一回事
 */
export const FILM_AI_TENANT_SLUG = 'drama_co';
export const FILM_AI_TENANT_NAME = 'Drama Co (短剧公司)';
export const FILM_AI_ADMIN_EMAIL = 'admin@drama-co.local';

export const filmAiV2OntologySpec: OntologySpec = {
  objectTypes: [
    {
      name: 'Book',
      label: '书',
      description: '一本上传的小说及其整体分析结果，是所有分析对象的根。一行=一本书。',
      properties: [
        { name: 'title', label: '标题', type: 'string', filterable: true, description: '小说标题' },
        { name: 'user_id', label: '上传者', type: 'string', filterable: true, description: '上传该小说的用户ID' },
        { name: 'total_chars', label: '总字数', type: 'number', filterable: true, sortable: true, description: '全书总字数', unit: '字' },
        { name: 'chapter_count', label: '章节数', type: 'number', filterable: true, sortable: true, description: '全书章节总数', unit: '章' },
        { name: 'status', label: '状态', type: 'string', filterable: true, description: '分析处理状态（如 pending/analyzing/done）' },
        { name: 'created_at', label: '创建时间', type: 'date', sortable: true, description: '小说上传/记录创建时间' },
        { name: 'overall_score', label: '综合评分', type: 'number', filterable: true, sortable: true, description: '作品综合质量评分（0-10 刻度，一位小数）。与 market_overall 不同：此项是 0-10 的内容质量分，market_overall 是 0-100 的市场分', unit: '分(0-10)' },
        { name: 'adaptation_score', label: '改编评分', type: 'number', filterable: true, sortable: true, description: '改编为影视/动漫的适配度评分（0-10 刻度）。找"最适合改编的书"用此字段', unit: '分(0-10)' },
        { name: 'data_completeness', label: '数据完整度', type: 'number', filterable: true, description: '该书分析数据的完整程度（0-1 比例，1=完全完整）', unit: '比例(0-1)' },
        { name: 'analysis_mode', label: '分析模式', type: 'string', filterable: true, description: '生成本次分析所用的模式/管线名称' },
        { name: 'tags', label: '题材标签', type: 'json', description: '题材分类标签数组（如 玄幻/都市/悬疑）。注意：数组类型，用于归类而非排序' },
        { name: 'tone', label: '基调', type: 'string', filterable: true, description: '作品整体情感基调（如 轻松/沉重/热血）' },
        { name: 'pace', label: '节奏描述', type: 'string', filterable: true, description: '对全书节奏的文字描述。若要按节奏快慢归类，配合 pace_type 使用' },
        { name: 'pov', label: '视角', type: 'string', filterable: true, description: '叙事视角（如 第一人称/第三人称/全知）' },
        { name: 'sentence', label: '语言风格', type: 'string', description: '语言/句式风格的文字描述' },
        { name: 'market_overall', label: '市场综合分', type: 'number', filterable: true, sortable: true, description: '市场潜力综合评分（0-100 刻度）。与 overall_score 不同：此项是 0-100 的市场分，overall_score 是 0-10 的内容质量分。问"市场前景最好的书"用此字段', unit: '分(0-100)' },
        { name: 'market_comparison', label: '市场对比', type: 'string', description: '与同类作品的市场对比文字分析' },
        { name: 'pace_type', label: '节奏类型', type: 'string', filterable: true, description: '节奏类型的归类标签（如 波浪式起伏/匀速推进/前慢后快）' },
        { name: 'avg_tension', label: '平均张力', type: 'number', filterable: true, sortable: true, description: '全书情感张力的平均值（0-100 刻度），等于情感曲线各采样点的均值，衡量整本书的整体紧张程度。比较"哪本书整体更紧张"用此字段；要找某一章的张力请用 ChapterSummary.emotionalTone', unit: '分(0-100)' },
        { name: 'peak_chapter', label: '高潮章节', type: 'string', description: '张力峰值所在章节的标识/标题' },
        { name: 'structure_template', label: '结构模板', type: 'string', filterable: true, description: '套用的叙事结构模板名称' },
        { name: 'structure_type', label: '结构类型', type: 'string', filterable: true, description: '叙事结构类型归类（如 三幕式/英雄之旅）' },
      ],
    },
    {
      name: 'BookCharacter',
      label: '角色',
      description: '小说中的一个人物。来自整书分析的人物网络（character_network.mainChars）。',
      properties: [
        { name: 'name', label: '姓名', type: 'string', filterable: true, description: '角色姓名' },
        { name: 'desc', label: '描述', type: 'string', description: '角色的人物简介/设定描述' },
        { name: 'role', label: '角色定位', type: 'string', filterable: true, description: '角色在故事中的定位（如 主角/反派/配角）。找某一类角色用此字段' },
      ],
    },
    {
      name: 'BookCharacterEdge',
      label: '角色关系',
      description: '两个角色之间的一条关系（人物关系网的边），如"养父子""盟友"。',
      properties: [
        { name: 'from_string', label: '起点（原字符串）', type: 'string', description: '关系起点角色的原始名称字符串（未解析为ID前）' },
        { name: 'to_string', label: '终点（原字符串）', type: 'string', description: '关系终点角色的原始名称字符串（未解析为ID前）' },
        { name: 'label', label: '关系描述', type: 'string', description: '两角色间的关系文字（如 养父子/盟友/敌对）' },
        { name: 'from_character_id', label: '起点角色ID', type: 'string', filterable: true, description: '关系起点角色的 BookCharacter 外部ID（实体解析后）' },
        { name: 'to_character_id', label: '终点角色ID', type: 'string', filterable: true, description: '关系终点角色的 BookCharacter 外部ID（实体解析后）' },
        { name: 'resolution_status', label: '解析状态', type: 'string', filterable: true, description: '角色名→ID 的解析状态（如 resolved/unresolved）。统计未解析关系用此字段' },
      ],
    },
    {
      name: 'PlotBeat',
      label: '剧情节拍',
      description: '全书剧情结构中的一个节拍（情节点），按 seq 顺序排列，刻画故事推进的关键节点。',
      properties: [
        { name: 'seq', label: '顺序', type: 'number', filterable: true, sortable: true, description: '节拍在全书中的先后顺序（从1递增）', unit: '序号' },
        { name: 'pct', label: '位置百分比', type: 'number', filterable: true, sortable: true, description: '该节拍在全书进度中的位置（0-100，表示落在故事的百分之几处）。如 50 表示故事中点', unit: '%' },
        { name: 'label', label: '节拍名', type: 'string', filterable: true, description: '节拍名称（如 开端/激励事件/高潮/结局）' },
        { name: 'desc', label: '节拍描述', type: 'string', description: '该节拍的剧情内容描述' },
      ],
    },
    {
      name: 'EmotionalCurvePoint',
      label: '情感曲线点',
      description: '情感张力曲线上的一个采样点（最细粒度的张力数据），按 seq 顺序连成全书张力曲线。',
      properties: [
        { name: 'seq', label: '顺序', type: 'number', filterable: true, sortable: true, description: '采样点在曲线上的顺序（从1递增）', unit: '序号' },
        { name: 'value', label: '张力值', type: 'number', filterable: true, sortable: true, description: '该采样点的情感张力值（0-100 刻度），与 ChapterSummary.emotionalTone 同刻度但粒度更细。找"张力峰值/拐点/曲线形态"用此字段；找整书均值用 Book.avg_tension', unit: '分(0-100)' },
      ],
    },
    {
      name: 'MarketScore',
      label: '市场评分',
      description: '市场潜力在某个维度上的单项评分（如 创意独特性、商业改编潜力），多条共同构成市场分析。',
      properties: [
        { name: 'label', label: '维度', type: 'string', filterable: true, description: '市场评分维度名称（如 创意独特性/故事连贯性/角色塑造/商业改编潜力）' },
        { name: 'score', label: '分数', type: 'number', filterable: true, sortable: true, description: '该维度的得分（0-100 刻度），与 Book.market_overall 同刻度（后者是各维度综合）。比较单一维度强弱用此字段', unit: '分(0-100)' },
      ],
    },
    {
      name: 'ChapterSummary',
      label: '章节摘要',
      description: '单个章节的分析摘要，含该章的情感张力、节奏密度、关键事件等。一行=一章。',
      properties: [
        { name: 'chapter_seq', label: '章节序号', type: 'number', filterable: true, sortable: true, description: '章节在全书中的序号（从1递增）', unit: '章' },
        { name: 'chapter_title', label: '章节标题', type: 'string', filterable: true, description: '章节标题' },
        { name: 'location', label: '地点', type: 'string', filterable: true, description: '该章主要发生地点/场景' },
        { name: 'plotAdvancement', label: '剧情推进', type: 'string', description: '该章对整体剧情的推进作用（文字描述）' },
        { name: 'emotionalTone', label: '情感张力', type: 'number', filterable: true, sortable: true, description: '该章的情感张力强度（0-100 刻度）。找"最紧张/最高潮的一章"用此字段；找整书均值用 Book.avg_tension，找曲线采样点用 EmotionalCurvePoint.value。注意勿与 pacingDensity(节奏密度)混淆', unit: '分(0-100)' },
        { name: 'pacingDensity', label: '节奏密度', type: 'number', filterable: true, sortable: true, description: '该章的节奏密度/叙事紧凑度（0-1 比例，越大越紧凑）。衡量叙事快慢，与 emotionalTone(情绪张力)是两回事', unit: '比例(0-1)' },
        { name: 'key_events', label: '关键事件', type: 'json', description: '该章关键事件列表（数组）' },
        { name: 'revelations', label: '揭示', type: 'json', description: '该章揭示的重要信息/反转列表（数组）' },
        { name: 'characters_string', label: '角色字符串', type: 'json', description: '该章出场角色的原始名称列表（数组，未解析为ID）' },
      ],
    },
    {
      name: 'ChapterCharacterMention',
      label: '章节角色提及',
      description: '某章节提及某角色的一条记录（章节↔角色的多对多桥接），用于追踪角色在各章的出场。',
      properties: [
        { name: 'chapter_summary_id', label: '章节ID', type: 'string', filterable: true, description: '被提及所在章节的 ChapterSummary 外部ID' },
        { name: 'book_character_id', label: '角色ID', type: 'string', filterable: true, description: '被提及角色的 BookCharacter 外部ID（实体解析后）' },
        { name: 'character_name_raw', label: '原字符串', type: 'string', description: '章节文本中角色的原始名称（解析为ID前）' },
        { name: 'resolution_status', label: '解析状态', type: 'string', filterable: true, description: '角色名→ID 的解析状态（如 resolved/unresolved）' },
      ],
    },
  ],
  relationships: [
    { sourceType: 'BookCharacter', targetType: 'Book', name: 'belongsTo', cardinality: 'one-to-many' },
    { sourceType: 'BookCharacterEdge', targetType: 'Book', name: 'belongsTo', cardinality: 'one-to-many' },
    { sourceType: 'PlotBeat', targetType: 'Book', name: 'belongsTo', cardinality: 'one-to-many' },
    { sourceType: 'EmotionalCurvePoint', targetType: 'Book', name: 'belongsTo', cardinality: 'one-to-many' },
    { sourceType: 'MarketScore', targetType: 'Book', name: 'belongsTo', cardinality: 'one-to-many' },
    { sourceType: 'ChapterSummary', targetType: 'Book', name: 'belongsTo', cardinality: 'one-to-many' },
    { sourceType: 'ChapterCharacterMention', targetType: 'Book', name: 'belongsTo', cardinality: 'one-to-many' },
  ],
};
