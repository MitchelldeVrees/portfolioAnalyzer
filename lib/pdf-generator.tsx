export function generateProfessionalReportStyles(): string {
  return `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
      
      * { margin: 0; padding: 0; box-sizing: border-box; }
      
      body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        line-height: 1.6;
        color: #1e293b;
        background: white;
      }
      
      .report-header {
        background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
        color: white;
        padding: 40px;
        text-align: center;
        position: relative;
        overflow: hidden;
      }
      
      .report-header::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>');
        opacity: 0.3;
      }
      
      .report-header h1 {
        font-size: 32px;
        font-weight: 700;
        margin-bottom: 8px;
        position: relative;
        z-index: 1;
      }
      
      .report-header .subtitle {
        font-size: 18px;
        font-weight: 300;
        opacity: 0.9;
        position: relative;
        z-index: 1;
      }
      
      .executive-summary {
        background: #f8fafc;
        padding: 30px;
        border-left: 4px solid #3b82f6;
        margin: 30px 0;
      }
      
      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 20px;
        margin: 30px 0;
      }
      
      .metric-card {
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 24px;
        text-align: center;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        transition: transform 0.2s;
      }
      
      .metric-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px -5px rgba(0, 0, 0, 0.1);
      }
      
      .chart-container {
        background: white;
        border-radius: 12px;
        padding: 24px;
        margin: 20px 0;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }
      
      .recommendation-box {
        background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
        border-left: 4px solid #f59e0b;
        padding: 20px;
        margin: 20px 0;
        border-radius: 0 8px 8px 0;
      }
      
      .risk-warning {
        background: #fee2e2;
        border-left: 4px solid #ef4444;
        padding: 16px;
        margin: 16px 0;
        border-radius: 0 4px 4px 0;
      }
      
      .footer-disclaimer {
        background: #f8fafc;
        padding: 30px;
        text-align: center;
        border-top: 2px solid #e2e8f0;
        margin-top: 40px;
        font-size: 11px;
        color: #64748b;
        line-height: 1.6;
      }
      
      @media print {
        .report-header { page-break-after: avoid; }
        .section { page-break-inside: avoid; }
        .metric-card { break-inside: avoid; }
      }
    </style>
  `
}

export function generateChartPlaceholder(type: "performance" | "allocation", width = 600, height = 300): string {
  const baseUrl = `https://quickchart.io/chart?width=${width}&height=${height}&format=png&backgroundColor=white`

  if (type === "performance") {
    return `${baseUrl}&chart={type:'line',data:{labels:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],datasets:[{label:'Portfolio',data:[100,102.5,98.8,105.2,108.7,106.3,112.1,109.4,115.8,118.2,121.6,124.3],borderColor:'%233b82f6',backgroundColor:'rgba(59,130,246,0.1)',fill:true},{label:'Benchmark',data:[100,101.2,99.5,103.1,104.8,106.2,108.9,107.3,111.2,113.5,115.8,117.2],borderColor:'%236b7280',backgroundColor:'rgba(107,114,128,0.1)',fill:true}]},options:{responsive:true,plugins:{legend:{position:'top'},title:{display:true,text:'Portfolio vs Benchmark Performance'}},scales:{y:{beginAtZero:false,title:{display:true,text:'Value (%)'}}}}}`
  }

  return `${baseUrl}&chart={type:'doughnut',data:{labels:['Technology','Healthcare','Financial','Consumer','Industrial','Energy','Other'],datasets:[{data:[35,15,20,12,10,5,3],backgroundColor:['%233b82f6','%2310b981','%23f59e0b','%23ef4444','%238b5cf6','%2306b6d4','%236b7280']}]},options:{responsive:true,plugins:{legend:{position:'right'},title:{display:true,text:'Sector Allocation'}}}}`
}
