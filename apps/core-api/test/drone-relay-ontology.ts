export const DRONE_RELAY_TENANT_SLUG = 'drone-relay-test';

export const objectTypes = [
  {
    name: 'merchant',
    label: '商家',
    properties: [
      { name: 'name', type: 'string', label: '名称', filterable: true, sortable: true },
      { name: 'lat', type: 'number', label: '纬度', filterable: true },
      { name: 'lng', type: 'number', label: '经度', filterable: true },
      { name: 'category', type: 'string', label: '品类', filterable: true },
    ],
  },
  {
    name: 'customer',
    label: '客户',
    properties: [
      { name: 'name', type: 'string', label: '姓名', filterable: true, sortable: true },
      { name: 'lat', type: 'number', label: '纬度', filterable: true },
      { name: 'lng', type: 'number', label: '经度', filterable: true },
      { name: 'district', type: 'string', label: '区域', filterable: true },
    ],
  },
  {
    name: 'relay_station',
    label: '中转站',
    properties: [
      { name: 'name', type: 'string', label: '名称', filterable: true, sortable: true },
      { name: 'lat', type: 'number', label: '纬度', filterable: true },
      { name: 'lng', type: 'number', label: '经度', filterable: true },
      { name: 'capacity', type: 'number', label: '容量', filterable: true, sortable: true },
      { name: 'droneSlots', type: 'number', label: '无人机停机位', filterable: true },
    ],
  },
  {
    name: 'drone',
    label: '无人机',
    properties: [
      { name: 'code', type: 'string', label: '编号', filterable: true, sortable: true },
      { name: 'maxRange', type: 'number', label: '最大航程(km)', filterable: true },
      { name: 'speed', type: 'number', label: '速度(km/h)', filterable: true },
      { name: 'payload', type: 'number', label: '载重(kg)', filterable: true },
      { name: 'status', type: 'string', label: '状态', filterable: true },
    ],
  },
  {
    name: 'rider',
    label: '骑手',
    properties: [
      { name: 'name', type: 'string', label: '姓名', filterable: true, sortable: true },
      { name: 'zone', type: 'string', label: '负责区域', filterable: true },
      { name: 'status', type: 'string', label: '状态', filterable: true },
      { name: 'speed', type: 'number', label: '速度(km/h)', filterable: true },
    ],
  },
  {
    name: 'delivery_order',
    label: '配送订单',
    properties: [
      { name: 'orderNo', type: 'string', label: '订单号', filterable: true, sortable: true },
      { name: 'createdAt', type: 'string', label: '创建时间', filterable: true, sortable: true },
      { name: 'deliveryMode', type: 'string', label: '配送模式', filterable: true },
      { name: 'status', type: 'string', label: '状态', filterable: true },
      { name: 'totalDistance', type: 'number', label: '总距离(km)', filterable: true, sortable: true },
      { name: 'totalTime', type: 'number', label: '总耗时(min)', filterable: true, sortable: true },
      { name: 'merchantName', type: 'string', label: '商家名称', filterable: true },
      { name: 'customerDistrict', type: 'string', label: '客户区域', filterable: true },
    ],
  },
  {
    name: 'delivery_leg',
    label: '配送段',
    properties: [
      { name: 'legType', type: 'string', label: '段类型', filterable: true },
      { name: 'distance', type: 'number', label: '距离(km)', filterable: true, sortable: true },
      { name: 'duration', type: 'number', label: '耗时(min)', filterable: true, sortable: true },
      { name: 'waitTime', type: 'number', label: '等待时间(min)', filterable: true, sortable: true },
      { name: 'carrier', type: 'string', label: '承运方', filterable: true },
      { name: 'stationName', type: 'string', label: '中转站', filterable: true },
    ],
  },
];

export const relationships = [
  { sourceName: 'merchant', targetName: 'delivery_order', name: 'merchant_orders', cardinality: 'one-to-many' },
  { sourceName: 'customer', targetName: 'delivery_order', name: 'customer_orders', cardinality: 'one-to-many' },
  { sourceName: 'delivery_order', targetName: 'delivery_leg', name: 'order_legs', cardinality: 'one-to-many' },
  { sourceName: 'relay_station', targetName: 'delivery_leg', name: 'station_legs', cardinality: 'one-to-many' },
];
