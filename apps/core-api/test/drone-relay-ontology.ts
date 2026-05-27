export const DRONE_RELAY_TENANT_SLUG = 'drone-relay-test';

export const objectTypes = [
  {
    name: 'merchant',
    label: '商家',
    description: '外卖商家，提供餐品的餐厅或店铺',
    properties: [
      { name: 'name', type: 'string', label: '名称', filterable: true, sortable: true, description: '商家名称' },
      { name: 'lat', type: 'number', label: '纬度', filterable: true, description: '商家位置纬度坐标' },
      { name: 'lng', type: 'number', label: '经度', filterable: true, description: '商家位置经度坐标' },
      { name: 'category', type: 'string', label: '品类', filterable: true, description: '商家经营品类（快餐、火锅、奶茶等）' },
    ],
  },
  {
    name: 'customer',
    label: '客户',
    description: '下单的外卖客户',
    properties: [
      { name: 'name', type: 'string', label: '姓名', filterable: true, sortable: true, description: '客户姓名' },
      { name: 'lat', type: 'number', label: '纬度', filterable: true, description: '客户收货地址纬度' },
      { name: 'lng', type: 'number', label: '经度', filterable: true, description: '客户收货地址经度' },
      { name: 'district', type: 'string', label: '区域', filterable: true, description: '客户所在行政区（如朝阳区、海淀区）' },
    ],
  },
  {
    name: 'relay_station',
    label: '中转站',
    description: '无人机与骑手的交接点，无人机在此降落，骑手从此取餐继续配送',
    properties: [
      { name: 'name', type: 'string', label: '名称', filterable: true, sortable: true, description: '中转站编号' },
      { name: 'lat', type: 'number', label: '纬度', filterable: true, description: '中转站位置纬度' },
      { name: 'lng', type: 'number', label: '经度', filterable: true, description: '中转站位置经度' },
      { name: 'capacity', type: 'number', label: '容量', filterable: true, sortable: true, description: '同时处理订单的最大能力', unit: '单' },
      { name: 'droneSlots', type: 'number', label: '无人机停机位', filterable: true, description: '可同时停放的无人机数量', unit: '个' },
    ],
  },
  {
    name: 'drone',
    label: '无人机',
    description: '执行商家到中转站空中配送的无人飞行器',
    properties: [
      { name: 'code', type: 'string', label: '编号', filterable: true, sortable: true, description: '无人机唯一编号' },
      { name: 'maxRange', type: 'number', label: '最大航程', filterable: true, description: '单次飞行最远距离', unit: 'km' },
      { name: 'speed', type: 'number', label: '速度', filterable: true, description: '巡航飞行速度', unit: 'km/h' },
      { name: 'payload', type: 'number', label: '载重', filterable: true, description: '最大载货重量', unit: 'kg' },
      { name: 'status', type: 'string', label: '状态', filterable: true, description: '当前状态（active=运行中, maintenance=维护中）' },
    ],
  },
  {
    name: 'rider',
    label: '骑手',
    description: '负责从中转站到客户最后一公里配送的骑手',
    properties: [
      { name: 'name', type: 'string', label: '姓名', filterable: true, sortable: true, description: '骑手姓名' },
      { name: 'zone', type: 'string', label: '负责区域', filterable: true, description: '骑手负责的配送区域' },
      { name: 'status', type: 'string', label: '状态', filterable: true, description: '当前状态（idle=空闲, delivering=配送中, offline=离线）' },
      { name: 'speed', type: 'number', label: '速度', filterable: true, description: '骑手平均骑行速度', unit: 'km/h' },
    ],
  },
  {
    name: 'delivery_order',
    label: '配送订单',
    description: '一次完整的外卖配送任务，从商家出发到客户签收',
    properties: [
      { name: 'orderNo', type: 'string', label: '订单号', filterable: true, sortable: true, description: '配送订单唯一编号' },
      { name: 'createdAt', type: 'string', label: '创建时间', filterable: true, sortable: true, description: '订单创建时间' },
      { name: 'deliveryMode', type: 'string', label: '配送模式', filterable: true, description: '配送方式：relay=无人机+骑手接力, rider_only=纯骑手配送' },
      { name: 'status', type: 'string', label: '状态', filterable: true, description: '订单状态：pending=待配送, in_transit=配送中, delivered=已送达' },
      { name: 'totalDistance', type: 'number', label: '总距离', filterable: true, sortable: true, description: '从商家到客户的配送总路程', unit: 'km' },
      { name: 'totalTime', type: 'number', label: '总耗时', filterable: true, sortable: true, description: '从取餐到送达的总配送时间', unit: 'min' },
      { name: 'merchantName', type: 'string', label: '商家名称', filterable: true, description: '出餐商家名称' },
      { name: 'customerDistrict', type: 'string', label: '客户区域', filterable: true, description: '收货客户所在区域' },
    ],
  },
  {
    name: 'delivery_leg',
    label: '配送段',
    description: '配送订单的一个运输段落，接力模式有两段（无人机段+骑手段），纯骑手模式只有一段',
    properties: [
      { name: 'legType', type: 'string', label: '段类型', filterable: true, description: '运输方式：drone=无人机飞行段, rider=骑手骑行段' },
      { name: 'distance', type: 'number', label: '距离', filterable: true, sortable: true, description: '该段的运输距离', unit: 'km' },
      { name: 'duration', type: 'number', label: '耗时', filterable: true, sortable: true, description: '该段的运输时间', unit: 'min' },
      { name: 'waitTime', type: 'number', label: '等待时间', filterable: true, sortable: true, description: '在中转站等待交接的时间', unit: 'min' },
      { name: 'carrier', type: 'string', label: '承运方', filterable: true, description: '执行该段运输的无人机编号或骑手姓名' },
      { name: 'stationName', type: 'string', label: '中转站', filterable: true, description: '该段经过的中转站编号' },
    ],
  },
];

export const relationships = [
  { sourceName: 'merchant', targetName: 'delivery_order', name: 'merchant_orders', cardinality: 'one-to-many' },
  { sourceName: 'customer', targetName: 'delivery_order', name: 'customer_orders', cardinality: 'one-to-many' },
  { sourceName: 'delivery_order', targetName: 'delivery_leg', name: 'order_legs', cardinality: 'one-to-many' },
  { sourceName: 'relay_station', targetName: 'delivery_leg', name: 'station_legs', cardinality: 'one-to-many' },
];
