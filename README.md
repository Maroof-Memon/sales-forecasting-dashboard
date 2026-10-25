# Sales Forecasting Dashboard

A Flask application for exploring historical sales data and generating a short-term sales forecast. The backend cleans uploaded CSV files, aggregates monthly revenue, fits a linear regression on a sequential month index, and evaluates it on a chronological holdout set. The frontend shows KPIs, charts, a three-month projection, and a searchable transaction table.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Maroof-Memon/sales-forecasting-dashboard)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Maroof-Memon/sales-forecasting-dashboard)

## Features

- CSV upload with date and sales column detection
- KPI cards for revenue, profit (when present), orders, and average order value
- Monthly revenue trend and category breakdown charts (Chart.js)
- Three-month linear regression forecast with out-of-sample MAE, RMSE, R2, and MAPE
- Optional currency conversion using open.er-api.com rates, with fallback rates when the API is unavailable
- Bundled sample dataset in `data/sales.csv` (USD)

## Project layout

```text
sales-forecasting-dashboard/
|-- app.py                Flask routes and application entry point
|-- forecast.py           Data cleaning, aggregation, and forecasting
|-- requirements.txt      Python dependencies
|-- run.bat               Windows launcher
|-- run.sh                macOS/Linux launcher
|-- data/
|   `-- sales.csv         Sample transaction data
|-- templates/
|   `-- index.html        Dashboard page
`-- static/
    |-- css/
    |   `-- style.css     Dashboard styles
    `-- js/
        `-- dashboard.js  Chart.js and API controller
```

## Setup

Requires Python 3.9 or newer.

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000. The `run.bat` and `run.sh` scripts install dependencies and start the server in one step.

## Run in GitHub Codespaces

Open the repository in a Codespace. The devcontainer installs the dependencies and starts the Flask server on port 5000. Make the forwarded port public if you need a shareable preview URL.

## Deploy

GitHub Pages cannot host a Flask server. The included `render.yaml` deploys the app to Render:

1. Create a Render account and connect this repository.
2. Create a new Blueprint and apply `render.yaml`.
3. Render installs `requirements.txt` and starts the app with Waitress.

The free Render plan sleeps after inactivity, so the first request after a pause may be slow.

## CSV format

Required columns:

- `Order Date` (or `Date`): any date format that pandas can parse
- `Sales` (or `Revenue`): sales amount; common currency symbols and codes are stripped before conversion to a number

Optional columns:

- `Order ID`, `Profit`, `Category`, `Product`, `Quantity`, `Currency`

If `Profit` or `Category` is missing, the related KPI or chart is hidden. The bundled sample uses the columns `Order ID`, `Order Date`, `Category`, `Product`, `Quantity`, `Sales`, and `Profit`.

## Forecasting method

The model is ordinary least squares linear regression on a sequential month index. The last 25% of months are held out for evaluation, then the model is refit on the full history for the three-month projection. Predictions are estimates, not actual sales.

Reported holdout metrics:

- MAE (mean absolute error)
- RMSE (root mean squared error)
- R2
- MAPE (mean absolute percentage error)

Forecasting is disabled when fewer than four distinct months are available.

## Notes

- The active dataset is held in memory and resets when the server restarts.
- Currency conversion changes displayed values only; the underlying data is not modified.
- Live exchange rates depend on a third-party API. If it is unavailable, built-in fallback rates are used.
