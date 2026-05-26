/**
 * Demo ontology spec — e-commerce operations scenario
 *
 * 5 objectTypes + 4 relationships. Designed to answer 3 demo questions:
 *   Q1: category sales ranking
 *   Q2: top-selling products vs their ratings (low-quality hits)
 *   Q3: weekend vs weekday order patterns
 *
 * weekday is redundantly stored on Order (not computed from orderDate) so
 * aggregate_objects can groupBy it directly without date-function support.
 * subtotal is redundantly stored on OrderItem for the same reason (avoid
 * runtime multiplication in aggregation SQL).
 */
import type { OntologySpec } from '../lib/ontology-bootstrap';

export const ecommerceOntology: OntologySpec = {
  objectTypes: [
    {
      name: 'product',
      label: '商品',
      properties: [
        { name: 'sku', type: 'string', label: 'SKU', required: true, filterable: true, sortable: true },
        { name: 'name', type: 'string', label: '商品名', required: true, filterable: true },
        { name: 'category', type: 'string', label: '品类', required: true, filterable: true },
        { name: 'price', type: 'number', label: '标价', required: true, filterable: true, sortable: true },
        { name: 'listedAt', type: 'date', label: '上架日期', filterable: true, sortable: true },
      ],
    },
    {
      name: 'customer',
      label: '客户',
      properties: [
        { name: 'externalId', type: 'string', label: '会员号', required: true, filterable: true },
        { name: 'nickname', type: 'string', label: '昵称', filterable: true },
        { name: 'city', type: 'string', label: '城市', required: true, filterable: true },
        { name: 'tier', type: 'string', label: '会员等级', required: true, filterable: true },
        { name: 'registeredAt', type: 'date', label: '注册日期', filterable: true, sortable: true },
      ],
    },
    {
      name: 'order',
      label: '订单',
      properties: [
        { name: 'orderNo', type: 'string', label: '订单号', required: true, filterable: true },
        { name: 'orderDate', type: 'date', label: '下单时间', required: true, filterable: true, sortable: true },
        { name: 'weekday', type: 'string', label: '星期', required: true, filterable: true },
        { name: 'totalAmount', type: 'number', label: '订单金额', required: true, filterable: true, sortable: true },
        { name: 'status', type: 'string', label: '状态', required: true, filterable: true },
      ],
    },
    {
      name: 'orderItem',
      label: '订单行',
      properties: [
        { name: 'quantity', type: 'number', label: '数量', required: true, filterable: true, sortable: true },
        { name: 'unitPrice', type: 'number', label: '成交价', required: true, filterable: true },
        { name: 'subtotal', type: 'number', label: '小计', required: true, filterable: true, sortable: true },
        { name: 'category', type: 'string', label: '品类', required: true, filterable: true },
      ],
    },
    {
      name: 'review',
      label: '评价',
      properties: [
        { name: 'rating', type: 'number', label: '星级', required: true, filterable: true, sortable: true },
        { name: 'reviewedAt', type: 'date', label: '评价时间', filterable: true, sortable: true },
        { name: 'hasImage', type: 'boolean', label: '有晒图', filterable: true },
      ],
    },
  ],
  relationships: [
    { sourceType: 'customer', targetType: 'order', name: 'orders', cardinality: 'one-to-many' },
    { sourceType: 'order', targetType: 'orderItem', name: 'items', cardinality: 'one-to-many' },
    { sourceType: 'orderItem', targetType: 'product', name: 'product', cardinality: 'many-to-many' },
    { sourceType: 'order', targetType: 'review', name: 'review', cardinality: 'one-to-one' },
  ],
};

/**
 * Category config — drives price bands, repurchase tendency, and rating distribution.
 * Signal layer uses these to plant stories.
 */
export interface CategoryConfig {
  name: string;
  productCount: number;
  priceMin: number;
  priceMax: number;
  baseRatingMean: number;
  weekendBoost: number;       // > 1 means this category sells more on weekends
}

export const CATEGORIES: CategoryConfig[] = [
  { name: '数码配件', productCount: 45, priceMin: 30,  priceMax: 500,  baseRatingMean: 4.2, weekendBoost: 0.9 },
  { name: '美妆护肤', productCount: 40, priceMin: 80,  priceMax: 800,  baseRatingMean: 4.5, weekendBoost: 0.95 },
  { name: '家居日用', productCount: 45, priceMin: 15,  priceMax: 300,  baseRatingMean: 4.0, weekendBoost: 1.2 },
  { name: '运动户外', productCount: 35, priceMin: 50,  priceMax: 1200, baseRatingMean: 3.8, weekendBoost: 1.1 },
  { name: '零食饮料', productCount: 35, priceMin: 20,  priceMax: 200,  baseRatingMean: 4.1, weekendBoost: 1.4 },
];

export const CITIES = [
  { name: '上海', weight: 18 },
  { name: '北京', weight: 16 },
  { name: '深圳', weight: 14 },
  { name: '广州', weight: 12 },
  { name: '杭州', weight: 14 },
  { name: '成都', weight: 11 },
  { name: '武汉', weight: 8 },
  { name: '西安', weight: 7 },
];

export const TIERS = [
  { name: '铜牌', weight: 60, monthlyOrderMean: 0.4 },
  { name: '银牌', weight: 25, monthlyOrderMean: 1.5 },
  { name: '金牌', weight: 12, monthlyOrderMean: 3.8 },
  { name: '钻石', weight: 3,  monthlyOrderMean: 7.0 },
];
