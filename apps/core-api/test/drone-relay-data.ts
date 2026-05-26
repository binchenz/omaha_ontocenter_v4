import * as crypto from 'crypto';
import { objectTypes, relationships } from './drone-relay-ontology';

// Deterministic PRNG (mulberry32)
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(2026);
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const randFloat = (min: number, max: number) => min + rand() * (max - min);
const round2 = (n: number) => Math.round(n * 100) / 100;
const pick = <T>(arr: T[]): T => arr[randInt(0, arr.length - 1)];

const DISTRICTS = ['朝阳区', '海淀区', '丰台区', '东城区', '西城区', '通州区', '大兴区', '昌平区'];
const CATEGORIES = ['快餐', '火锅', '奶茶', '烧烤', '日料', '西餐', '粤菜', '川菜'];
const ZONES = ['zone-A', 'zone-B', 'zone-C', 'zone-D', 'zone-E'];

// PLACEHOLDER_DATA_GEN

export interface GeneratedData {
  merchants: any[];
  customers: any[];
  relayStations: any[];
  drones: any[];
  riders: any[];
  deliveryOrders: any[];
  deliveryLegs: any[];
}

export function generateData(tenantId: string): GeneratedData {
  const merchants = Array.from({ length: 100 }, (_, i) => ({
    id: crypto.randomUUID(),
    tenantId,
    objectType: 'merchant',
    externalId: `M-${String(i + 1).padStart(3, '0')}`,
    label: `商家${i + 1}`,
    properties: {
      name: `商家${i + 1}`,
      lat: round2(39.9 + randFloat(-0.1, 0.1)),
      lng: round2(116.4 + randFloat(-0.1, 0.1)),
      category: pick(CATEGORIES),
    },
    relationships: {},
  }));

  const customers = Array.from({ length: 1000 }, (_, i) => ({
    id: crypto.randomUUID(),
    tenantId,
    objectType: 'customer',
    externalId: `CU-${String(i + 1).padStart(4, '0')}`,
    label: `客户${i + 1}`,
    properties: {
      name: `客户${i + 1}`,
      lat: round2(39.9 + randFloat(-0.15, 0.15)),
      lng: round2(116.4 + randFloat(-0.15, 0.15)),
      district: pick(DISTRICTS),
    },
    relationships: {},
  }));

  const relayStations = Array.from({ length: 20 }, (_, i) => ({
    id: crypto.randomUUID(),
    tenantId,
    objectType: 'relay_station',
    externalId: `station-${String(i + 1).padStart(2, '0')}`,
    label: `中转站${i + 1}`,
    properties: {
      name: `station-${String(i + 1).padStart(2, '0')}`,
      lat: round2(39.9 + randFloat(-0.08, 0.08)),
      lng: round2(116.4 + randFloat(-0.08, 0.08)),
      capacity: randInt(20, 50),
      droneSlots: randInt(3, 8),
    },
    relationships: {},
  }));

  const drones = Array.from({ length: 50 }, (_, i) => ({
    id: crypto.randomUUID(),
    tenantId,
    objectType: 'drone',
    externalId: `UAV-${String(i + 1).padStart(2, '0')}`,
    label: `无人机${i + 1}`,
    properties: {
      code: `UAV-${String(i + 1).padStart(2, '0')}`,
      maxRange: randInt(8, 15),
      speed: randInt(40, 80),
      payload: round2(randFloat(2, 5)),
      status: rand() < 0.7 ? 'active' : 'maintenance',
    },
    relationships: {},
  }));

  const riders = Array.from({ length: 200 }, (_, i) => ({
    id: crypto.randomUUID(),
    tenantId,
    objectType: 'rider',
    externalId: `R-${String(i + 1).padStart(3, '0')}`,
    label: `骑手${i + 1}`,
    properties: {
      name: `骑手${i + 1}`,
      zone: pick(ZONES),
      status: rand() < 0.6 ? 'idle' : rand() < 0.8 ? 'delivering' : 'offline',
      speed: round2(randFloat(15, 30)),
    },
    relationships: {},
  }));

  const deliveryOrders: any[] = [];
  const deliveryLegs: any[] = [];

  const now = Date.now();
  const activeDrones = drones.filter(d => d.properties.status === 'active');

  for (let i = 0; i < 5000; i++) {
    const orderId = crypto.randomUUID();
    const merchant = pick(merchants);
    const customer = pick(customers);
    const totalDistance = round2(randFloat(1, 15));
    const isRelay = i < 3000; // 60% relay, 40% rider_only
    const deliveryMode = isRelay ? 'relay' : 'rider_only';

    // Story signals:
    // - relay > 5km: faster (totalTime lower)
    // - relay < 3km: slower (wait overhead)
    let totalTime: number;
    if (isRelay) {
      if (totalDistance > 5) {
        totalTime = round2(totalDistance * 2.5 + randFloat(2, 8));
      } else if (totalDistance < 3) {
        totalTime = round2(totalDistance * 5 + randFloat(5, 12));
      } else {
        totalTime = round2(totalDistance * 3.5 + randFloat(3, 8));
      }
    } else {
      if (totalDistance > 5) {
        totalTime = round2(totalDistance * 3.5 + randFloat(5, 15));
      } else {
        totalTime = round2(totalDistance * 3 + randFloat(2, 6));
      }
    }

    const hoursAgo = randFloat(0, 24);
    const createdAt = new Date(now - hoursAgo * 3600000).toISOString();
    const status = rand() < 0.15 ? 'pending' : rand() < 0.3 ? 'in_transit' : 'delivered';
    const orderNo = `DO-${String(i + 1).padStart(5, '0')}`;

    deliveryOrders.push({
      id: orderId,
      tenantId,
      objectType: 'delivery_order',
      externalId: orderNo,
      label: orderNo,
      properties: {
        orderNo,
        createdAt,
        deliveryMode,
        status,
        totalDistance,
        totalTime,
        merchantName: merchant.properties.name,
        customerDistrict: customer.properties.district,
      },
      relationships: {
        merchant_orders: merchant.id,
        customer_orders: customer.id,
      },
    });

    if (isRelay) {
      // Drone leg (merchant → station)
      const station = i % 20 === 4
        ? relayStations[4] // station-05 gets extra load (bottleneck signal)
        : pick(relayStations);
      const drone = i < 500
        ? activeDrones[0] // UAV-01 gets extra load (utilization signal)
        : pick(activeDrones);
      const droneDist = round2(totalDistance * randFloat(0.4, 0.6));
      const droneSpeed = drone.properties.speed as number;
      const droneDuration = round2((droneDist / droneSpeed) * 60);
      const waitTime = station === relayStations[4]
        ? round2(randFloat(5, 12)) // station-05 high wait
        : round2(randFloat(0.5, 3));

      deliveryLegs.push({
        id: crypto.randomUUID(),
        tenantId,
        objectType: 'delivery_leg',
        externalId: `${orderNo}-L1`,
        label: `${orderNo}-L1`,
        properties: {
          legType: 'drone',
          distance: droneDist,
          duration: droneDuration,
          waitTime,
          carrier: drone.properties.code,
          stationName: station.properties.name,
        },
        relationships: {
          order_legs: orderId,
          station_legs: station.id,
        },
      });

      // Rider leg (station → customer)
      const rider = pick(riders);
      const riderDist = round2(totalDistance - droneDist);
      const riderSpeed = rider.properties.speed as number;
      const riderDuration = round2((riderDist / riderSpeed) * 60);

      deliveryLegs.push({
        id: crypto.randomUUID(),
        tenantId,
        objectType: 'delivery_leg',
        externalId: `${orderNo}-L2`,
        label: `${orderNo}-L2`,
        properties: {
          legType: 'rider',
          distance: riderDist,
          duration: riderDuration,
          waitTime: 0,
          carrier: rider.properties.name,
          stationName: station.properties.name,
        },
        relationships: {
          order_legs: orderId,
          station_legs: station.id,
        },
      });
    } else {
      // Single rider leg
      const rider = pick(riders);
      const riderSpeed = rider.properties.speed as number;
      const duration = round2((totalDistance / riderSpeed) * 60);

      deliveryLegs.push({
        id: crypto.randomUUID(),
        tenantId,
        objectType: 'delivery_leg',
        externalId: `${orderNo}-L1`,
        label: `${orderNo}-L1`,
        properties: {
          legType: 'rider',
          distance: totalDistance,
          duration,
          waitTime: 0,
          carrier: rider.properties.name,
          stationName: '',
        },
        relationships: { order_legs: orderId },
      });
    }
  }

  return { merchants, customers, relayStations, drones, riders, deliveryOrders, deliveryLegs };
}
