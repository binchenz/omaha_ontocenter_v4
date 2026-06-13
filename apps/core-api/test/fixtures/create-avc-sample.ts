import ExcelJS from 'exceljs';
import * as path from 'path';

async function createAvcSample() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');

  sheet.addRow(['品牌', '型号', '零售额(万元)', '零售量(万台)', '品类', '月份']);

  const brands = ['美的', '格力', '海尔', '纯米', '九阳'];
  for (let i = 0; i < 50; i++) {
    const brand = brands[i % brands.length];
    sheet.addRow([brand, `型号${i + 1}`, (10 + i * 2.5).toFixed(1), (1 + i * 0.1).toFixed(2), '电饭煲', '25.01']);
  }

  const outPath = path.join(__dirname, 'avc-sample.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log('Created:', outPath);
}

createAvcSample().catch(console.error);
