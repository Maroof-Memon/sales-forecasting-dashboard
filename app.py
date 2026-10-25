"""
Flask entry point for the sales dashboard.
"""

import os
import io
import zipfile
from flask import Flask, render_template, request, jsonify, send_file
from forecast import (
    clean_and_process_sales_data,
    compute_kpis,
    aggregate_monthly_trends,
    aggregate_category_sales,
    train_and_forecast_sales
)

app = Flask(__name__, template_folder='templates', static_folder='static')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB max upload limit

DEFAULT_CSV_PATH = os.path.join(os.path.dirname(__file__), 'data', 'sales.csv')

# Active dataset (held in memory).
current_df = None
current_metadata = None
current_dataset_name = "data/sales.csv (Sample Dataset)"


def get_current_data():
    """Load the default dataset if no dataset is active."""
    global current_df, current_metadata, current_dataset_name
    if current_df is None:
        if not os.path.exists(DEFAULT_CSV_PATH):
            raise FileNotFoundError(f"Default dataset not found at {DEFAULT_CSV_PATH}")
        current_df, current_metadata = clean_and_process_sales_data(DEFAULT_CSV_PATH)
        current_dataset_name = "data/sales.csv (Sample Dataset)"
    return current_df, current_metadata, current_dataset_name


@app.route('/')
def index():
    """Renders the main dashboard HTML template."""
    return render_template('index.html')


@app.route('/api/data', methods=['GET'])
def get_dashboard_data():
    """Return dashboard metrics, trends, categories, transactions, and the forecast."""
    try:
        df, metadata, dataset_name = get_current_data()

        kpis = compute_kpis(df, metadata)

        monthly_df = aggregate_monthly_trends(df, metadata)
        monthly_trend_records = monthly_df.to_dict(orient='records')

        category_records = aggregate_category_sales(df, metadata)

        forecast_result = train_and_forecast_sales(monthly_df, forecast_periods=3)

        table_cols = ['Order ID', 'Order Date', 'Quantity', 'Sales']
        if metadata['has_profit']:
            table_cols.append('Profit')
        if metadata['has_category']:
            table_cols.append('Category')
        if 'Product' in df.columns:
            table_cols.append('Product')

        display_df = df[table_cols].copy()
        display_df['Order Date'] = display_df['Order Date'].dt.strftime('%Y-%m-%d')
        transactions = display_df.tail(50).iloc[::-1].to_dict(orient='records')

        available_years = sorted(df['Year'].unique().tolist())

        return jsonify({
            'success': True,
            'dataset_name': dataset_name,
            'metadata': metadata,
            'kpis': kpis,
            'monthly_trend': monthly_trend_records,
            'category_sales': category_records,
            'forecast': forecast_result,
            'transactions': transactions,
            'available_years': available_years
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400


@app.route('/api/upload', methods=['POST'])
def upload_csv():
    """Validate an uploaded CSV and make it the active dataset."""
    global current_df, current_metadata, current_dataset_name

    stream = None
    filename = 'uploaded_sales.csv'

    # JSON payload.
    if request.is_json:
        data = request.get_json() or {}
        csv_text = data.get('csv', '')
        filename = data.get('filename', 'uploaded_sales.csv')
        if not csv_text or not csv_text.strip():
            return jsonify({'success': False, 'error': 'No CSV content provided.'}), 400
        stream = io.StringIO(csv_text)

    # Multipart form upload.
    elif 'file' in request.files:
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected.'}), 400
        if not file.filename.lower().endswith('.csv'):
            return jsonify({'success': False, 'error': 'Invalid file format. Please upload a .csv file.'}), 400
        filename = file.filename
        stream = io.StringIO(file.stream.read().decode('utf-8', errors='replace'))

    else:
        return jsonify({'success': False, 'error': 'No file or CSV data received.'}), 400

    try:
        df, metadata = clean_and_process_sales_data(stream)

        # Update active dataset
        current_df = df
        current_metadata = metadata
        current_dataset_name = filename

        return jsonify({
            'success': True,
            'message': f"Successfully loaded {metadata['total_rows']} rows from {filename}.",
            'dataset_name': current_dataset_name,
            'metadata': metadata
        })

    except ValueError as ve:
        return jsonify({'success': False, 'error': f"Validation Error: {str(ve)}"}), 422
    except Exception as e:
        return jsonify({'success': False, 'error': f"Processing Error: {str(e)}"}), 500


@app.route("/api/reset", methods=["POST"])
def reset_dataset():
    """Reset the dashboard to the default sample CSV dataset."""
    global current_df, current_metadata, current_dataset_name

    try:
        if not os.path.isfile(DEFAULT_CSV_PATH):
            return jsonify({
                "success": False,
                "error": f"Default dataset not found: {DEFAULT_CSV_PATH}",
            }), 404

        df, metadata = clean_and_process_sales_data(DEFAULT_CSV_PATH)

        current_df = df
        current_metadata = metadata
        current_dataset_name = "data/sales.csv (Sample Dataset)"

        return jsonify({
            "success": True,
            "message": "Dataset reset successfully.",
            "dataset_name": current_dataset_name,
            "metadata": current_metadata,
        })

    except Exception as exc:
        app.logger.exception("Failed to reset dataset")

        return jsonify({
            "success": False,
            "error": str(exc),
        }), 500

@app.route('/api/download-zip', methods=['GET'])
def download_project_zip():
    """Return the project source as a zip archive."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    memory_file = io.BytesIO()

    files_to_pack = [
        ('app.py', os.path.join(base_dir, 'app.py')),
        ('forecast.py', os.path.join(base_dir, 'forecast.py')),
        ('requirements.txt', os.path.join(base_dir, 'requirements.txt')),
        ('README.md', os.path.join(base_dir, 'README.md')),
        ('run.bat', os.path.join(base_dir, 'run.bat')),
        ('run.sh', os.path.join(base_dir, 'run.sh')),
        (os.path.join('data', 'sales.csv'), os.path.join(base_dir, 'data', 'sales.csv')),
        (os.path.join('templates', 'index.html'), os.path.join(base_dir, 'templates', 'index.html')),
        (os.path.join('static', 'css', 'style.css'), os.path.join(base_dir, 'static', 'css', 'style.css')),
        (os.path.join('static', 'js', 'dashboard.js'), os.path.join(base_dir, 'static', 'js', 'dashboard.js')),
    ]

    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for arcname, filepath in files_to_pack:
            if os.path.exists(filepath):
                zf.write(filepath, arcname=f"sales-forecasting-dashboard/{arcname}")

    memory_file.seek(0)
    return send_file(
        memory_file,
        mimetype='application/zip',
        as_attachment=True,
        download_name='sales-forecasting-dashboard.zip'
    )


if __name__ == '__main__':
    print("=" * 60)
    print("  Sales Forecasting and Business Dashboard (Flask)")
    print("  Running locally at: http://127.0.0.1:5000")
    print("  Press Ctrl+C to quit.")
    print("=" * 60)
    app.run(host='127.0.0.1', port=5000, debug=True)
