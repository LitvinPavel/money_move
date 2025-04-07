export type AccountType = 'deposit' | 'savings' | 'investment' | 'credit';

export type TotalBalanceResponse = { total: number };
export type GroupedBalanceResponse = Record<string, number>;

export interface IAccount {
  id: number;
  user_id: number;
  account_number: string;
  account_name: string;
  bank_name: string;
  type: AccountType;
  plan?: number;
  interest_rate?: number | null;
  balance: number;
  currency: string;
  created_at: Date;
  is_salary: boolean;
}

export interface ICreateAccount {
  currency: string;
  initialBalance?: number;
  account_name: string;
  bank_bic: string;
  type: AccountType;
  plan?: number;
  interest_rate?: number | null;
  is_salary?: boolean;
}

export interface IUpdateAccount {
  currency?: string;
  balance?: number;
  account_name?: string;
  bank_bic?: string;
  type?: AccountType;
  plan?: number;
  interest_rate?: number | null;
  is_salary?: boolean;
}

export interface IDeleteAccount {
  accountId: number;
}
