/**
 * Dashboard controller: API loading, Chart.js rendering, currency conversion.
 */

// Global Chart.js instances
let trendChartInstance = null;
let categoryChartInstance = null;
let forecastChartInstance = null;
let cachedDashboardData = null;
let cachedTransactions = [];

// Fallback exchange rates (USD = 1.0) used when the live API is unavailable.
const BENCHMARK_RATES_TO_USD = {
  USD: 1.0,
  PKR: 276.256037,
  EUR: 0.892578,
  GBP: 0.770500,
  INR: 83.250000,
  AED: 3.672500,
  SAR: 3.750000,
};

let liveRates = { ...BENCHMARK_RATES_TO_USD };
let isLiveSynced = false;

// Currency definitions and symbols
const CURRENCIES = {
  PKR: { code: 'PKR', symbol: 'Rs. ', label: 'Pakistani Rupee' },
  USD: { code: 'USD', symbol: '$', label: 'US Dollar' },
  EUR: { code: 'EUR', symbol: '€', label: 'Euro' },
  GBP: { code: 'GBP', symbol: '£', label: 'British Pound' },
  INR: { code: 'INR', symbol: '₹', label: 'Indian Rupee' },
  AED: { code: 'AED', symbol: 'AED ', label: 'UAE Dirham' },
  SAR: { code: 'SAR', symbol: 'SAR ', label: 'Saudi Riyal' },
};

// Active state
let activeBaseCurrency = 'PKR';     // Original currency of the raw dataset
let activeDisplayCurrency = 'PKR';  // Currency displayed across dashboard

// Currency Conversion Core
function convertValue(amount, fromCurr, toCurr) {
  if (amount === null || amount === undefined || isNaN(amount)) return amount;
  if (fromCurr === toCurr) return Number(amount);

  const rateFrom = liveRates[fromCurr] || BENCHMARK_RATES_TO_USD[fromCurr] || 1.0;
  const rateTo = liveRates[toCurr] || BENCHMARK_RATES_TO_USD[toCurr] || 1.0;

  // Convert source -> USD -> target
  const inUSD = Number(amount) / rateFrom;
  return inUSD * rateTo;
}

// Format number with active target currency symbol
function formatCurrency(amount, currencyCode = activeDisplayCurrency) {
  const curr = CURRENCIES[currencyCode] || CURRENCIES['USD'];
  if (amount === null || amount === undefined || isNaN(amount)) {
    return `${curr.symbol}0.00`;
  }
  const formattedNum = Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${curr.symbol}${formattedNum}`;
}

// Format integer
function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return Number(num).toLocaleString('en-US');
}

// Show alert banner
function showAlert(message, type = 'error') {
  const alertBox = document.getElementById('alert-box');
  const alertMsg = document.getElementById('alert-message');
  if (!alertBox || !alertMsg) return;

  alertBox.className = `alert ${type}`;
  alertMsg.textContent = message;
  alertBox.classList.remove('hidden');

  if (type === 'success') {
    setTimeout(() => {
      alertBox.classList.add('hidden');
    }, 5000);
  }
}

function hideAlert() {
  const alertBox = document.getElementById('alert-box');
  if (alertBox) alertBox.classList.add('hidden');
}

// Fetch live exchange rates from public API
async function syncLiveExchangeRates() {
  const statusLabel = document.getElementById('rate-status-label');
  const pulse = document.querySelector('.live-pulse');

  try {
    if (statusLabel) statusLabel.textContent = 'Syncing live rates...';
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();

    if (data && data.rates && data.rates.PKR) {
      Object.keys(BENCHMARK_RATES_TO_USD).forEach(code => {
        if (data.rates[code]) {
          liveRates[code] = data.rates[code];
        }
      });
      isLiveSynced = true;
      if (statusLabel) statusLabel.textContent = 'Live Exchange Rates Active:';
      if (pulse) pulse.style.backgroundColor = '#10b981';
      showAlert(`Live exchange rates synced: 1 USD = ${liveRates.PKR.toFixed(2)} PKR`, 'success');
    }
  } catch (err) {
    console.warn('Exchange-rate API unavailable; using fallback rates.', err);
    if (statusLabel) statusLabel.textContent = 'Standard Benchmark Rates:';
  }

  updateExchangeRibbon();
  if (cachedDashboardData) {
    renderDashboard(cachedDashboardData);
  }
}

// Update the exchange ribbon display
function updateExchangeRibbon() {
  const rateSummary = document.getElementById('rate-summary-text');
  const notice = document.getElementById('conversion-notice');

  const usdToPkr = (liveRates.PKR / liveRates.USD).toFixed(2);
  const eurToPkr = (liveRates.PKR / liveRates.EUR).toFixed(2);

  if (rateSummary) {
    rateSummary.textContent = `1 USD = ${usdToPkr} PKR · 1 EUR = ${eurToPkr} PKR`;
  }

  if (notice) {
    if (activeBaseCurrency === activeDisplayCurrency) {
      notice.textContent = `Viewing raw dataset prices in ${activeBaseCurrency}`;
    } else {
      const fromCurr = activeBaseCurrency;
      const toCurr = activeDisplayCurrency;
      const directRate = (liveRates[toCurr] / liveRates[fromCurr]);
      notice.innerHTML = `Converted from <strong>${fromCurr}</strong> to <strong>${toCurr}</strong> (1 ${fromCurr} = ${directRate < 0.01 ? directRate.toFixed(5) : directRate.toFixed(2)} ${toCurr})`;
    }
  }
}

// Fetch dashboard data from Flask API
async function fetchDashboardData() {
  try {
    const res = await fetch('/api/data');
    const data = await res.json();

    if (!data.success) {
      showAlert(data.error || 'Failed to load dashboard data.', 'error');
      return;
    }

    // Auto-detect base currency from metadata if present
    const detected = data.metadata?.currency_code || data.kpis?.currency_code;
    if (detected && CURRENCIES[detected]) {
      activeBaseCurrency = detected;
      activeDisplayCurrency = detected; // Default display matches data
    }

    const baseSelect = document.getElementById('base-currency-select');
    if (baseSelect) baseSelect.value = activeBaseCurrency;

    const displaySelect = document.getElementById('display-currency-select');
    if (displaySelect) displaySelect.value = activeDisplayCurrency;

    renderDashboard(data);
  } catch (err) {
    showAlert('Network error connecting to Flask backend. Please ensure "python app.py" is running.', 'error');
    console.error('Fetch error:', err);
  }
}

// Render the dashboard from an API response.
function renderDashboard(payload) {
  cachedDashboardData = payload;
  const { dataset_name, metadata, kpis, monthly_trend, category_sales, forecast, transactions } = payload;

  updateExchangeRibbon();

  // 1. Toolbar info
  const nameEl = document.getElementById('active-dataset-name');
  const rowsEl = document.getElementById('dataset-row-count');
  if (nameEl) nameEl.textContent = dataset_name || 'Active Dataset';
  if (rowsEl) rowsEl.textContent = `(${formatNumber(metadata.total_rows)} transactions · Base: ${activeBaseCurrency})`;

  // 2. Convert and Render KPIs
  const convertedSales = convertValue(kpis.total_sales, activeBaseCurrency, activeDisplayCurrency);
  const convertedProfit = kpis.total_profit !== null
    ? convertValue(kpis.total_profit, activeBaseCurrency, activeDisplayCurrency)
    : null;
  const convertedAOV = convertValue(kpis.avg_order_value, activeBaseCurrency, activeDisplayCurrency);

  document.getElementById('kpi-total-sales').textContent = formatCurrency(convertedSales);
  document.getElementById('kpi-total-orders').textContent = formatNumber(kpis.total_orders);
  document.getElementById('kpi-avg-order-value').textContent = formatCurrency(convertedAOV);

  // Profit KPI: If unavailable in dataset, hide related card
  const profitCard = document.getElementById('kpi-profit-card');
  if (metadata.has_profit && convertedProfit !== null) {
    profitCard.style.display = 'block';
    document.getElementById('kpi-total-profit').textContent = formatCurrency(convertedProfit);
    document.getElementById('kpi-profit-margin').textContent = `${kpis.profit_margin}% overall margin`;
  } else {
    profitCard.style.display = 'none';
  }

  // 3. Render Monthly Sales Trend Chart (Converted)
  renderMonthlyTrendChart(monthly_trend);

  // 4. Render Sales by Category Chart (Converted)
  const categoryCard = document.getElementById('category-chart-card');
  if (metadata.has_category && category_sales && category_sales.length > 0) {
    categoryCard.style.display = 'block';
    renderCategoryChart(category_sales);
  } else {
    categoryCard.style.display = 'none';
  }

  // 5. Render Machine Learning Forecasting (Converted)
  renderForecastSection(forecast);

  // 6. Render Historical Transactions Table (Converted)
  cachedTransactions = transactions || [];
  renderTransactionsTable(cachedTransactions, metadata);
}

// Monthly sales trend.
function renderMonthlyTrendChart(monthlyData) {
  const ctx = document.getElementById('monthlyTrendChart');
  if (!ctx || typeof Chart === 'undefined') return;

  const labels = monthlyData.map(d => d.date_label);
  const convertedSales = monthlyData.map(d =>
    convertValue(d.sales, activeBaseCurrency, activeDisplayCurrency)
  );

  const displayCurr = CURRENCIES[activeDisplayCurrency] || CURRENCIES['USD'];

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  trendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: `Monthly Sales (${displayCurr.code})`,
        data: convertedSales,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.08)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.25,
        pointBackgroundColor: '#2563eb',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 1.5,
        pointRadius: 4,
        pointHoverRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Sales: ${formatCurrency(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 }, maxRotation: 45, minRotation: 45 }
        },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: {
            font: { size: 11 },
            callback: (val) => displayCurr.symbol + Number(val).toLocaleString()
          }
        }
      }
    }
  });
}

// Sales by category.
function renderCategoryChart(categoryData) {
  const ctx = document.getElementById('categorySalesChart');
  if (!ctx || typeof Chart === 'undefined') return;

  const labels = categoryData.map(d => d.Category);
  const convertedSales = categoryData.map(d =>
    convertValue(d.sales, activeBaseCurrency, activeDisplayCurrency)
  );

  const displayCurr = CURRENCIES[activeDisplayCurrency] || CURRENCIES['USD'];

  if (categoryChartInstance) {
    categoryChartInstance.destroy();
  }

  categoryChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: `Category Sales (${displayCurr.code})`,
        data: convertedSales,
        backgroundColor: '#0284c7',
        borderRadius: 4,
        maxBarThickness: 48,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Sales: ${formatCurrency(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 } }
        },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: {
            font: { size: 11 },
            callback: (val) => displayCurr.symbol + Number(val).toLocaleString()
          }
        }
      }
    }
  });
}

// Forecast section.
function renderForecastSection(forecast) {
  const metricsContainer = document.getElementById('model-metrics-container');
  const cardsContainer = document.getElementById('forecast-cards-grid');
  const ctx = document.getElementById('forecastChart');

  if (!forecast || !forecast.can_forecast) {
    if (metricsContainer) metricsContainer.innerHTML = '<span class="text-muted">Insufficient historical data to train model.</span>';
    if (cardsContainer) cardsContainer.innerHTML = '';
    if (forecastChartInstance) forecastChartInstance.destroy();
    return;
  }

  // Model evaluation strip (MAE and RMSE converted)
  const evalData = forecast.evaluation;
  const convertedMAE = convertValue(evalData.test_mae, activeBaseCurrency, activeDisplayCurrency);
  const convertedRMSE = convertValue(evalData.test_rmse, activeBaseCurrency, activeDisplayCurrency);

  if (metricsContainer) {
    metricsContainer.innerHTML = `
      <span>Train: <strong>${evalData.train_samples} mo</strong></span>
      <span>·</span>
      <span>Test: <strong>${evalData.test_samples} mo</strong></span>
      <span>·</span>
      <span>Test MAE: <strong>${formatCurrency(convertedMAE)}</strong></span>
      <span>·</span>
      <span>Test RMSE: <strong>${formatCurrency(convertedRMSE)}</strong></span>
      <span>·</span>
      <span>Test R²: <strong>${evalData.test_r2}</strong></span>
    `;
  }

  // 3-Month Projection Cards (Converted)
  if (cardsContainer && forecast.future_forecasts) {
    cardsContainer.innerHTML = forecast.future_forecasts.map(item => {
      const convertedPred = convertValue(item.predicted_sales, activeBaseCurrency, activeDisplayCurrency);
      return `
        <div class="forecast-callout">
          <div class="forecast-callout-month">${item.label.replace(' (Estimate)', '')}</div>
          <div class="forecast-callout-value">${formatCurrency(convertedPred)}</div>
          <div class="forecast-callout-sub">Scikit-learn projected estimate (${activeDisplayCurrency})</div>
        </div>
      `;
    }).join('');
  }

  // Forecast Chart
  if (!ctx || typeof Chart === 'undefined') return;

  const chartSeries = forecast.chart_series;
  const labels = chartSeries.map(d => d.label);
  const convertedActuals = chartSeries.map(d =>
    d.actual_sales !== null ? convertValue(d.actual_sales, activeBaseCurrency, activeDisplayCurrency) : null
  );
  const convertedPredictions = chartSeries.map(d =>
    d.forecast_sales !== null ? convertValue(d.forecast_sales, activeBaseCurrency, activeDisplayCurrency) : null
  );

  const displayCurr = CURRENCIES[activeDisplayCurrency] || CURRENCIES['USD'];

  if (forecastChartInstance) {
    forecastChartInstance.destroy();
  }

  forecastChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: `Historical Actual Sales (${displayCurr.code})`,
          data: convertedActuals,
          borderColor: '#2563eb',
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointBackgroundColor: '#2563eb',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointRadius: 4,
          tension: 0.2,
        },
        {
          label: `Predicted Sales (Forecast Estimate - ${displayCurr.code})`,
          data: convertedPredictions,
          borderColor: '#ea580c',
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          borderDash: [6, 4],
          pointBackgroundColor: '#ea580c',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointRadius: 5,
          tension: 0.2,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { boxWidth: 12, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed.y;
              if (val === null || val === undefined) return '';
              const isForecast = ctx.datasetIndex === 1;
              return `${ctx.dataset.label}: ${formatCurrency(val)}${isForecast ? ' *' : ''}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 }, maxRotation: 45, minRotation: 45 }
        },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: {
            font: { size: 11 },
            callback: (val) => displayCurr.symbol + Number(val).toLocaleString()
          }
        }
      }
    }
  });
}

// Transactions table.
function renderTransactionsTable(transactions, metadata) {
  const tbody = document.getElementById('table-body');
  const thProfit = document.getElementById('th-profit');
  if (!tbody) return;

  if (thProfit) {
    thProfit.style.display = metadata.has_profit ? '' : 'none';
  }

  if (!transactions || transactions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">No transactions found.</td></tr>';
    return;
  }

  tbody.innerHTML = transactions.map(r => {
    const convertedSales = convertValue(r['Sales'], activeBaseCurrency, activeDisplayCurrency);
    const convertedProfit = r['Profit'] !== null && r['Profit'] !== undefined
      ? convertValue(r['Profit'], activeBaseCurrency, activeDisplayCurrency)
      : null;

    return `
      <tr>
        <td style="font-family: monospace; font-weight: 600;">${r['Order ID'] || '-'}</td>
        <td>${r['Order Date'] || '-'}</td>
        <td>${r['Category'] || '-'}</td>
        <td class="text-muted">${r['Product'] || '-'}</td>
        <td class="text-right">${r['Quantity'] !== undefined ? r['Quantity'] : 1}</td>
        <td class="text-right" style="font-weight: 600;">${formatCurrency(convertedSales)}</td>
        ${metadata.has_profit ? `<td class="text-right" style="color: #059669; font-weight: 600;">${convertedProfit !== null ? formatCurrency(convertedProfit) : '-'}</td>` : ''}
      </tr>
    `;
  }).join('');
}

// Currency selectors.
document.getElementById('base-currency-select')?.addEventListener('change', (e) => {
  activeBaseCurrency = e.target.value;
  if (cachedDashboardData) {
    renderDashboard(cachedDashboardData);
  }
});

document.getElementById('display-currency-select')?.addEventListener('change', (e) => {
  activeDisplayCurrency = e.target.value;
  if (cachedDashboardData) {
    renderDashboard(cachedDashboardData);
  }
});

// Refresh rates.
document.getElementById('btn-refresh-rates')?.addEventListener('click', () => {
  syncLiveExchangeRates();
});

// Table search.
document.getElementById('table-search-input')?.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  if (!query) {
    renderTransactionsTable(cachedTransactions, cachedDashboardData ? cachedDashboardData.metadata : { has_profit: true });
    return;
  }

  const filtered = cachedTransactions.filter(r => {
    return (
      (r['Order ID'] && r['Order ID'].toLowerCase().includes(query)) ||
      (r['Category'] && r['Category'].toLowerCase().includes(query)) ||
      (r['Product'] && r['Product'].toLowerCase().includes(query)) ||
      (r['Order Date'] && r['Order Date'].includes(query))
    );
  });

  renderTransactionsTable(filtered, cachedDashboardData ? cachedDashboardData.metadata : { has_profit: true });
});

// CSV upload.
document.getElementById('csv-file-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.csv')) {
    showAlert('Please select a valid CSV (.csv) file.', 'error');
    e.target.value = '';
    return;
  }

  try {
    const csvContent = await file.text();
    if (!csvContent || !csvContent.trim()) {
      showAlert('The selected CSV file appears to be empty.', 'error');
      e.target.value = '';
      return;
    }

    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, csv: csvContent })
    });

    const result = await res.json();

    if (result.success) {
      const curCode = result.metadata?.currency_code || 'USD';
      activeBaseCurrency = curCode;
      activeDisplayCurrency = curCode;

      const baseSelect = document.getElementById('base-currency-select');
      if (baseSelect) baseSelect.value = curCode;

      const displaySelect = document.getElementById('display-currency-select');
      if (displaySelect) displaySelect.value = curCode;

      showAlert(`${result.message} (Data Currency: ${curCode})`, 'success');
      fetchDashboardData();
    } else {
      showAlert(result.error || 'Failed to process uploaded CSV.', 'error');
    }
  } catch (err) {
    showAlert(`Error uploading CSV: ${err.message || 'Server communication error'}`, 'error');
    console.error('Upload error:', err);
  } finally {
    e.target.value = '';
  }
});

// Reset dataset.
document.getElementById('btn-reset-data')?.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/reset', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      showAlert('Reset to default sample dataset.', 'success');
      fetchDashboardData();
    }
  } catch (err) {
    showAlert('Failed to reset dataset.', 'error');
  }
});

// Project download.
document.getElementById('btn-export-zip')?.addEventListener('click', async () => {
  window.location.href = '/api/download-zip';
});

// Alert close.
document.getElementById('alert-close')?.addEventListener('click', hideAlert);

// Initial load.
document.addEventListener('DOMContentLoaded', () => {
  syncLiveExchangeRates();
  fetchDashboardData();
});
