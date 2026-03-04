# Setup

## 1. Clone and install

```bash
git clone https://github.com/chessman/postgres-hackers-explorer
cd postgres-hackers-explorer
npm install
```

## 2. Environment variables

Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

## 3. Set up the database

Run the schema in Neon SQL editor (or via `psql`):

```bash
psql $DATABASE_URL_UNPOOLED -f neon/schema.sql
```

## 4. Run the crawler

```bash
cd crawler
pip install -r requirements.txt
python main.py --months 3          # last 3 months
python main.py --all               # full archive (slow)
```

The crawler scrapes `lists.postgresql.org/pgsql-hackers/`, generates embeddings locally via `fastembed`, and bulk-upserts into Neon.

## 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
