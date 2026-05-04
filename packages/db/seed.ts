import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'Demo Company',
      slug: 'demo',
      settings: { timezone: 'Asia/Shanghai', language: 'zh-CN' },
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'admin' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'admin',
      permissions: ['*'],
    },
  });

  const opsRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'operator' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'operator',
      permissions: ['object.read', 'object.query', 'action.preview'],
    },
  });

  const passwordHash = await bcrypt.hash('admin123', 10);

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@demo.com',
      name: 'Admin',
      passwordHash,
      roleId: adminRole.id,
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'ops@demo.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'ops@demo.com',
      name: 'Operator',
      passwordHash,
      roleId: opsRole.id,
    },
  });

  // --- Ontology: ObjectTypes ---
  const customerType = await prisma.objectType.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'customer' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'customer',
      label: '客户',
      properties: [
        { name: 'name', label: '客户名称', type: 'string', required: true, filterable: true },
        { name: 'contact', label: '联系人', type: 'string', filterable: true },
        { name: 'phone', label: '电话', type: 'string' },
        { name: 'region', label: '区域', type: 'string', filterable: true, sortable: true },
        { name: 'level', label: '客户等级', type: 'string', filterable: true },
      ],
    },
  });

  const productType = await prisma.objectType.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'product' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'product',
      label: '产品',
      properties: [
        { name: 'name', label: '产品名称', type: 'string', required: true },
        { name: 'sku', label: 'SKU', type: 'string', required: true },
        { name: 'category', label: '分类', type: 'string' },
        { name: 'price', label: '单价', type: 'number' },
        { name: 'unit', label: '单位', type: 'string' },
      ],
    },
  });

  const orderType = await prisma.objectType.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'order' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'order',
      label: '订单',
      properties: [
        { name: 'orderNo', label: '订单编号', type: 'string', required: true, filterable: true },
        { name: 'orderDate', label: '下单日期', type: 'date', required: true, filterable: true, sortable: true },
        { name: 'totalAmount', label: '总金额', type: 'number', filterable: true, sortable: true },
        { name: 'status', label: '状态', type: 'string', filterable: true },
      ],
      derivedProperties: [
        { name: 'itemCount', label: '商品数量', type: 'number' },
      ],
    },
  });

  // --- Ontology: Relationships ---
  await prisma.objectRelationship.upsert({
    where: { tenantId_sourceTypeId_name: { tenantId: tenant.id, sourceTypeId: customerType.id, name: 'has_orders' } },
    update: {},
    create: {
      tenantId: tenant.id,
      sourceTypeId: customerType.id,
      targetTypeId: orderType.id,
      name: 'has_orders',
      cardinality: 'one-to-many',
    },
  });

  await prisma.objectRelationship.upsert({
    where: { tenantId_sourceTypeId_name: { tenantId: tenant.id, sourceTypeId: orderType.id, name: 'contains_products' } },
    update: {},
    create: {
      tenantId: tenant.id,
      sourceTypeId: orderType.id,
      targetTypeId: productType.id,
      name: 'contains_products',
      cardinality: 'many-to-many',
    },
  });

  // --- Connector ---
  const connector = await prisma.connector.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'demo-erp' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'demo-erp',
      type: 'postgresql',
      config: { host: 'localhost', port: 5432, database: 'erp_demo' },
      status: 'active',
    },
  });

  // --- Mappings ---
  await prisma.objectMapping.upsert({
    where: { tenantId_objectTypeId_connectorId: { tenantId: tenant.id, objectTypeId: customerType.id, connectorId: connector.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      objectTypeId: customerType.id,
      connectorId: connector.id,
      tableName: 'erp_customers',
      propertyMappings: {
        name: { objectProperty: 'name', sourceColumn: 'customer_name' },
        contact: { objectProperty: 'contact', sourceColumn: 'contact_person' },
        phone: { objectProperty: 'phone', sourceColumn: 'phone_number' },
        region: { objectProperty: 'region', sourceColumn: 'region' },
        level: { objectProperty: 'level', sourceColumn: 'customer_level' },
      },
    },
  });

  // --- Sample ObjectInstances ---
  const customers = [
    { externalId: 'C001', label: '华东科技有限公司', properties: { name: '华东科技有限公司', contact: '张三', phone: '13800138001', region: '华东', level: 'A' } },
    { externalId: 'C002', label: '南方贸易集团', properties: { name: '南方贸易集团', contact: '李四', phone: '13800138002', region: '华南', level: 'B' } },
    { externalId: 'C003', label: '北方工业有限公司', properties: { name: '北方工业有限公司', contact: '王五', phone: '13800138003', region: '华北', level: 'A' } },
  ];

  for (const c of customers) {
    await prisma.objectInstance.upsert({
      where: { tenantId_objectType_externalId: { tenantId: tenant.id, objectType: 'customer', externalId: c.externalId } },
      update: {},
      create: {
        tenantId: tenant.id,
        objectType: 'customer',
        externalId: c.externalId,
        label: c.label,
        properties: c.properties,
        searchText: `${c.properties.name} ${c.properties.contact} ${c.properties.region}`,
      },
    });
  }

  const products = [
    { externalId: 'P001', label: '工业传感器A型', properties: { name: '工业传感器A型', sku: 'SENSOR-A', category: '传感器', price: 2500, unit: '个' } },
    { externalId: 'P002', label: '控制模块B型', properties: { name: '控制模块B型', sku: 'CTRL-B', category: '控制器', price: 8000, unit: '套' } },
  ];

  for (const p of products) {
    await prisma.objectInstance.upsert({
      where: { tenantId_objectType_externalId: { tenantId: tenant.id, objectType: 'product', externalId: p.externalId } },
      update: {},
      create: {
        tenantId: tenant.id,
        objectType: 'product',
        externalId: p.externalId,
        label: p.label,
        properties: p.properties,
        searchText: `${p.properties.name} ${p.properties.sku} ${p.properties.category}`,
      },
    });
  }

  const orders = [
    { externalId: 'O2024001', label: '订单 O2024001', properties: { orderNo: 'O2024001', orderDate: '2024-03-15', totalAmount: 75000, status: '已完成' }, relationships: { customer: 'C001', products: ['P001', 'P002'] } },
    { externalId: 'O2024002', label: '订单 O2024002', properties: { orderNo: 'O2024002', orderDate: '2024-04-20', totalAmount: 25000, status: '进行中' }, relationships: { customer: 'C002', products: ['P001'] } },
  ];

  for (const o of orders) {
    await prisma.objectInstance.upsert({
      where: { tenantId_objectType_externalId: { tenantId: tenant.id, objectType: 'order', externalId: o.externalId } },
      update: {},
      create: {
        tenantId: tenant.id,
        objectType: 'order',
        externalId: o.externalId,
        label: o.label,
        properties: o.properties,
        relationships: o.relationships,
        searchText: `${o.properties.orderNo} ${o.properties.status}`,
      },
    });
  }

  console.log('Seed complete: tenant=%s, objectTypes=3, relationships=2, instances=7', tenant.slug);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
