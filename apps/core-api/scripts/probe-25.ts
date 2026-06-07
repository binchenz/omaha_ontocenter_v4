import ExcelJS from 'exceljs';
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(process.argv[2]);
  console.log('=== all sheets ===');
  wb.eachSheet(s => console.log('  ', s.name, `(rows=${s.rowCount})`));
  const sh = wb.getWorksheet('2-5主要品牌零售竞争');
  if (!sh) { console.log('NO 2-5 sheet'); return; }
  console.log('\n=== 2-5 first 40 rows, cols A-K (trimmed) ===');
  for (let r = 1; r <= Math.min(40, sh.rowCount); r++) {
    const row = sh.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= 12; c++) {
      const v = row.getCell(c).value as any;
      let t = v == null ? '' : (typeof v === 'object' && 'result' in v ? String(v.result) : String(v));
      if (typeof v === 'number') t = v.toFixed(3);
      cells.push(t.slice(0, 10));
    }
    if (cells.some(x => x.trim())) console.log(`r${r}: ` + cells.map((x,i)=>`${String.fromCharCode(65+i)}=${x}`).filter(x=>!x.endsWith('=')).join(' | '));
  }
})().catch(e=>{console.error(e.message);process.exit(1)});
