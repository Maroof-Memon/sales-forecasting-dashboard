"""
Data cleaning, aggregation, and sales forecasting.
"""

import re
import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score


def clean_and_process_sales_data(filepath_or_buffer):
    """
    Loads, cleans, and standardizes a sales dataset.
    
    Returns:
        df: Cleaned transaction-level DataFrame
        metadata: Dict detailing available columns (has_profit, has_category)
    """
    df = pd.read_csv(filepath_or_buffer)

    if df.empty:
        raise ValueError("The uploaded CSV file is empty.")

    # Standardize column headers (strip whitespace and handle case variations)
    original_cols = list(df.columns)
    col_map = {}
    for col in original_cols:
        normalized = col.strip().lower()
        if normalized in ['order date', 'date', 'order_date', 'transaction_date']:
            col_map[col] = 'Order Date'
        elif normalized in ['sales', 'revenue', 'amount', 'total_sales']:
            col_map[col] = 'Sales'
        elif normalized in ['profit', 'net_profit', 'margin']:
            col_map[col] = 'Profit'
        elif normalized in ['order id', 'order_id', 'id', 'transaction_id']:
            col_map[col] = 'Order ID'
        elif normalized in ['category', 'product_category', 'department']:
            col_map[col] = 'Category'
        elif normalized in ['quantity', 'qty', 'units']:
            col_map[col] = 'Quantity'
        elif normalized in ['product', 'product_name', 'item']:
            col_map[col] = 'Product'

    df = df.rename(columns=col_map)

    # Validate essential columns
    if 'Order Date' not in df.columns:
        raise ValueError("Missing required date column. Expected 'Order Date' or 'Date'.")
    if 'Sales' not in df.columns:
        raise ValueError("Missing required sales column. Expected 'Sales' or 'Revenue'.")

    # Clean dates
    df['Order Date'] = pd.to_datetime(df['Order Date'], errors='coerce')
    df = df.dropna(subset=['Order Date', 'Sales']).copy()

    if df.empty:
        raise ValueError("No valid rows remaining after filtering invalid dates and sales values.")

    # Currency Detection from headers or Currency column
    detected_currency = 'USD'
    detected_symbol = '$'

    headers_str = " ".join(original_cols).lower()
    if re.search(r'\b(pkr|rs|rupees?|₨)\b', headers_str):
        detected_currency = 'PKR'
        detected_symbol = 'Rs. '
    elif re.search(r'\b(inr|₹)\b', headers_str):
        detected_currency = 'INR'
        detected_symbol = '₹'
    elif re.search(r'\b(eur|€|euro)\b', headers_str):
        detected_currency = 'EUR'
        detected_symbol = '€'
    elif re.search(r'\b(gbp|£|pound)\b', headers_str):
        detected_currency = 'GBP'
        detected_symbol = '£'
    elif re.search(r'\b(aed|dirham)\b', headers_str):
        detected_currency = 'AED'
        detected_symbol = 'AED '
    elif re.search(r'\b(sar|riyal)\b', headers_str):
        detected_currency = 'SAR'
        detected_symbol = 'SAR '

    # Also check if an explicit Currency column exists
    curr_col = next((c for c in original_cols if c.strip().lower() in ['currency', 'curr', 'currency_code']), None)
    if curr_col and not df[curr_col].dropna().empty:
        val_cur = str(df[curr_col].dropna().iloc[0]).strip().upper()
        if 'PKR' in val_cur or 'RS' in val_cur:
            detected_currency = 'PKR'
            detected_symbol = 'Rs. '
        elif 'INR' in val_cur:
            detected_currency = 'INR'
            detected_symbol = '₹'
        elif 'EUR' in val_cur:
            detected_currency = 'EUR'
            detected_symbol = '€'
        elif 'GBP' in val_cur:
            detected_currency = 'GBP'
            detected_symbol = '£'
        elif 'USD' in val_cur:
            detected_currency = 'USD'
            detected_symbol = '$'

    # Check sample cell values in sales column for currency symbols/words
    if 'Sales' in df.columns:
        sample_sales_text = " ".join(df['Sales'].dropna().astype(str).head(30)).lower()
        if re.search(r'(pkr|rs\.?|₨|rupee)', sample_sales_text):
            detected_currency = 'PKR'
            detected_symbol = 'Rs. '
        elif re.search(r'[€]|eur', sample_sales_text):
            detected_currency = 'EUR'
            detected_symbol = '€'
        elif re.search(r'[£]|gbp', sample_sales_text):
            detected_currency = 'GBP'
            detected_symbol = '£'
        elif re.search(r'[₹]|inr', sample_sales_text):
            detected_currency = 'INR'
            detected_symbol = '₹'

    def clean_numeric_value(val):
        if pd.isna(val):
            return np.nan
        s = str(val).strip()
        # Remove currency words/symbols
        s = re.sub(r'(?i)\b(pkr|rs|rupees?|inr|usd|eur|gbp|aed|sar)\b', '', s)
        s = re.sub(r'[₨\$€£₹,\s]', '', s)
        s = re.sub(r'^[.]+', '', s).strip()
        try:
            return float(s)
        except (TypeError, ValueError):
            return np.nan

    # Clean numeric sales with currency tolerance
    df['Sales'] = df['Sales'].apply(clean_numeric_value)
    df = df.dropna(subset=['Sales']).copy()
    df = df[df['Sales'] >= 0].copy()

    # Sort chronologically to preserve time-series ordering
    df = df.sort_values('Order Date').reset_index(drop=True)

    # Only expose optional fields that exist in the source.
    has_profit = 'Profit' in df.columns
    if has_profit:
        df['Profit'] = df['Profit'].apply(clean_numeric_value)

    has_category = 'Category' in df.columns
    if has_category:
        df['Category'] = df['Category'].fillna('Uncategorized').astype(str).str.strip()

    if 'Order ID' not in df.columns:
        df['Order ID'] = [f"ORD-{i+1:04d}" for i in range(len(df))]

    if 'Quantity' in df.columns:
        df['Quantity'] = pd.to_numeric(df['Quantity'], errors='coerce').fillna(1).astype(int)
    else:
        df['Quantity'] = 1

    # Extract time components for grouping
    df['Year'] = df['Order Date'].dt.year
    df['Month'] = df['Order Date'].dt.strftime('%b')
    df['YearMonth'] = df['Order Date'].dt.strftime('%Y-%m')

    metadata = {
        'has_profit': bool(has_profit and not df['Profit'].dropna().empty),
        'has_category': bool(has_category and df['Category'].nunique() > 0),
        'total_rows': int(len(df)),
        'date_min': df['Order Date'].min().strftime('%Y-%m-%d'),
        'date_max': df['Order Date'].max().strftime('%Y-%m-%d'),
        'currency_code': detected_currency,
        'currency_symbol': detected_symbol,
    }

    return df, metadata


def compute_kpis(df, metadata):
    """
    Computes overall summary KPIs.
    """
    total_sales = float(df['Sales'].sum())
    total_orders = int(df['Order ID'].nunique())
    avg_order_value = float(total_sales / total_orders) if total_orders > 0 else 0.0

    kpis = {
        'total_sales': round(total_sales, 2),
        'total_orders': total_orders,
        'avg_order_value': round(avg_order_value, 2),
        'has_profit': metadata['has_profit'],
        'currency_code': metadata.get('currency_code', 'USD'),
        'currency_symbol': metadata.get('currency_symbol', '$'),
    }

    if metadata['has_profit']:
        total_profit = float(df['Profit'].dropna().sum())
        profit_margin = float((total_profit / total_sales) * 100) if total_sales > 0 else 0.0
        kpis['total_profit'] = round(total_profit, 2)
        kpis['profit_margin'] = round(profit_margin, 1)
    else:
        kpis['total_profit'] = None
        kpis['profit_margin'] = None

    return kpis


def aggregate_monthly_trends(df, metadata):
    """
    Aggregates historical sales into continuous chronological monthly data points.
    """
    # Group by Year-Month string
    grouped = df.groupby('YearMonth').agg(
        sales=('Sales', 'sum'),
        orders=('Order ID', 'nunique'),
    ).reset_index()

    if metadata['has_profit']:
        profit_grouped = df.groupby('YearMonth')['Profit'].sum().reset_index()
        grouped['profit'] = profit_grouped['Profit'].round(2)

    grouped['sales'] = grouped['sales'].round(2)
    grouped = grouped.sort_values('YearMonth').reset_index(drop=True)

    # Format human-friendly labels (e.g. "Jan 2024")
    labels = []
    for ym in grouped['YearMonth']:
        parts = ym.split('-')
        year = parts[0]
        month_int = int(parts[1])
        month_abbr = pd.to_datetime(f"{year}-{month_int:02d}-01").strftime('%b')
        labels.append(f"{month_abbr} {year}")

    grouped['date_label'] = labels
    return grouped


def aggregate_category_sales(df, metadata):
    """
    Aggregates sales by product category if available.
    """
    if not metadata['has_category']:
        return []

    cat_df = df.groupby('Category').agg(
        sales=('Sales', 'sum'),
        orders=('Order ID', 'nunique')
    ).reset_index()

    cat_df['sales'] = cat_df['sales'].round(2)
    cat_df = cat_df.sort_values('sales', ascending=False)

    return cat_df.to_dict(orient='records')


def train_and_forecast_sales(monthly_df, forecast_periods=3):
    """
    Fit a linear regression on a sequential month index.

    The last 25% of months are held out for evaluation. The model is then
    refit on the full history to project ``forecast_periods`` future months.
    """
    n_months = len(monthly_df)

    if n_months < 4:
        return {
            'error': 'At least 4 distinct months of sales history are required to train and evaluate the forecasting model.',
            'can_forecast': False
        }

    # Sequential month index.
    monthly_df = monthly_df.copy()
    monthly_df['time_idx'] = np.arange(n_months)

    # Features: time index
    X = monthly_df[['time_idx']].values
    y = monthly_df['sales'].values

    # Chronological holdout split.
    test_size = max(1, int(n_months * 0.25))
    train_size = n_months - test_size

    X_train, X_test = X[:train_size], X[train_size:]
    y_train, y_test = y[:train_size], y[train_size:]

    # Fit on the training partition.
    eval_model = LinearRegression()
    eval_model.fit(X_train, y_train)

    y_test_pred = eval_model.predict(X_test)
    test_mae = float(mean_absolute_error(y_test, y_test_pred))
    test_rmse = float(np.sqrt(mean_squared_error(y_test, y_test_pred)))

    # R2 is undefined when the holdout has no variance.
    if len(y_test) > 1 and np.var(y_test) > 0:
        test_r2 = float(r2_score(y_test, y_test_pred))
        test_r2_display = round(test_r2, 3)
    else:
        test_r2_display = "N/A (single test point)"

    nonzero_actuals = y_test != 0
    if nonzero_actuals.any():
        mape = float(
            np.mean(
                np.abs(
                    (y_test[nonzero_actuals] - y_test_pred[nonzero_actuals])
                    / y_test[nonzero_actuals]
                )
            ) * 100
        )
    else:
        mape = None

    # Refit on all observations for the projection.
    full_model = LinearRegression()
    full_model.fit(X, y)

    slope = float(full_model.coef_[0])

    # Future month indices.
    future_indices = np.arange(n_months, n_months + forecast_periods).reshape(-1, 1)
    future_preds = full_model.predict(future_indices)

    # Calculate future calendar dates
    last_ym = monthly_df['YearMonth'].iloc[-1]
    last_date = pd.to_datetime(f"{last_ym}-01")

    forecast_items = []
    for i, pred_val in enumerate(future_preds):
        future_date = last_date + pd.DateOffset(months=i + 1)
        future_ym = future_date.strftime('%Y-%m')
        future_label = future_date.strftime('%b %Y')
        forecast_items.append({
            'year_month': future_ym,
            'label': f"{future_label} (Estimate)",
            'predicted_sales': round(max(0.0, float(pred_val)), 2),
            'is_forecast': True
        })

    # Chart series: history plus forecast.
    chart_series = []
    for _, row in monthly_df.iterrows():
        chart_series.append({
            'year_month': row['YearMonth'],
            'label': row['date_label'],
            'actual_sales': round(float(row['sales']), 2),
            'forecast_sales': None,
            'is_forecast': False
        })

    # Repeat the last actual so the forecast line connects.
    last_hist = chart_series[-1]
    chart_series.append({
        'year_month': last_hist['year_month'],
        'label': last_hist['label'],
        'actual_sales': last_hist['actual_sales'],
        'forecast_sales': last_hist['actual_sales'],
        'is_forecast': False
    })

    for f_item in forecast_items:
        chart_series.append({
            'year_month': f_item['year_month'],
            'label': f_item['label'],
            'actual_sales': None,
            'forecast_sales': f_item['predicted_sales'],
            'is_forecast': True
        })

    model_evaluation = {
        'train_samples': int(train_size),
        'test_samples': int(test_size),
        'test_mae': round(test_mae, 2),
        'test_rmse': round(test_rmse, 2),
        'test_r2': test_r2_display,
        'test_mape_pct': round(mape, 1) if mape is not None else None,
        'monthly_trend_slope': round(slope, 2),
        'method': 'Ordinary least squares linear regression on a sequential month index',
    }

    return {
        'can_forecast': True,
        'chart_series': chart_series,
        'future_forecasts': forecast_items,
        'evaluation': model_evaluation
    }
