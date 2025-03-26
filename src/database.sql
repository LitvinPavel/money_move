CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
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
    account_name VARCHAR(255) NOT NULL,
    bank_name VARCHAR(255) UNIQUE NOT NULL,
    balance DECIMAL(15, 2) DEFAULT 0.00,
    currency VARCHAR(3) DEFAULT 'RUS',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bank_accounts_user_id ON bank_accounts(user_id);
CREATE INDEX idx_bank_accounts_account_number ON bank_accounts(account_number);

CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
  related_account_id INTEGER REFERENCES bank_accounts(id),
  related_transaction_id INTEGER REFERENCES transactions(id),
  amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
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