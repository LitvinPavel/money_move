CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    default_reporting_period_days INTEGER DEFAULT 30,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_users_email ON users(email);

CREATE TABLE refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL
);

CREATE TABLE bank_accounts (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_number VARCHAR(20) UNIQUE NOT NULL,
    account_name VARCHAR(255) UNIQUE NOT NULL,
    bank_name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'savings', 'investment', 'credit')),
    balance DECIMAL(15, 2) DEFAULT 0.00,
    plan DECIMAL(15, 2) NOT NULL DEFAULT 0,
    debt DECIMAL(15, 2) NOT NULL DEFAULT 0,
    is_salary BOOLEAN DEFAULT FALSE,
    interest_rate DECIMAL(5, 2),
    currency VARCHAR(3) DEFAULT 'RUB',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT interest_rate_check CHECK (
    (type = 'deposit' AND interest_rate IS NULL) OR
    (type != 'deposit' AND interest_rate IS NOT NULL)
  )
);

CREATE INDEX idx_bank_accounts_user_id ON bank_accounts(user_id);
CREATE INDEX idx_bank_accounts_account_number ON bank_accounts(account_number);

CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
  related_account_id INTEGER REFERENCES bank_accounts(id),
  related_transaction_id INTEGER REFERENCES transactions(id),
  amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
  bank_name VARCHAR(255),
  type VARCHAR(20) NOT NULL CHECK (type IN (
    'deposit', 
    'withdrawal', 
    'transfer_out', 
    'transfer_in'
  )),
  status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN (
    'pending',
    'completed',
    'failed',
    'cancelled'
  )),
  is_debt BOOLEAN DEFAULT FALSE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_related_account FOREIGN KEY (related_account_id) 
    REFERENCES bank_accounts(id) ON DELETE SET NULL,
  CONSTRAINT fk_related_transaction FOREIGN KEY (related_transaction_id) 
    REFERENCES transactions(id) ON DELETE SET NULL
);

CREATE INDEX idx_transactions_account ON transactions(account_id);
CREATE INDEX idx_transactions_related ON transactions(related_transaction_id);
CREATE INDEX idx_transactions_created ON transactions(created_at);

CREATE OR REPLACE FUNCTION generate_account_number() 
RETURNS VARCHAR AS $$
DECLARE
    new_number VARCHAR;
BEGIN
    LOOP
        new_number := LPAD(FLOOR(random() * 10000000000)::TEXT, 10, '0');
        
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM bank_accounts WHERE account_number = new_number
        );
    END LOOP;
    
    RETURN new_number;
END;
$$ LANGUAGE plpgsql;



CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_timestamp
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_bank_accounts_timestamp
BEFORE UPDATE ON bank_accounts
FOR EACH ROW EXECUTE FUNCTION update_timestamp();


-- Таблица зарплат
CREATE TABLE salaries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_salary DECIMAL(10,2) NOT NULL CHECK (base_salary > 0),
  effective_from DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_salary_per_date UNIQUE (user_id, effective_from)
);

-- Таблица отпусков
CREATE TABLE vacations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Таблица кэша производственного календаря
CREATE TABLE calendar_cache (
  key VARCHAR(20) PRIMARY KEY, -- Например: 'workdays_2024'
  data TEXT NOT NULL,          -- JSON-строка с данными календаря
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для оптимизации
CREATE INDEX idx_salaries_user ON salaries(user_id);
CREATE INDEX idx_salaries_date ON salaries(effective_from);
CREATE INDEX idx_vacations_user ON vacations(user_id);
CREATE INDEX idx_vacations_dates ON vacations(start_date, end_date);
CREATE INDEX idx_calendar_cache_expiry ON calendar_cache(expires_at);

-- Индексы для accounts
CREATE INDEX idx_accounts_user_id ON bank_accounts(user_id);
CREATE INDEX idx_accounts_type ON bank_accounts(type);
CREATE INDEX idx_accounts_bank_name ON bank_accounts(bank_name);

-- Индексы для transactions
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_date ON transactions(created_at);
CREATE INDEX idx_transactions_from_account ON transactions(from_account_id);
CREATE INDEX idx_transactions_to_account ON transactions(to_account_id);
