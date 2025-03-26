export interface IAccount {
  id: number;
  user_id: number;
  account_number: string;
  account_name: string;
  bank_name: string;
  balance: number;
  currency: string;
  created_at: Date;
}

export interface ICreateAccount {
  currency: string;
  initialBalance?: number;
  account_name: string;
  bank_name: string;
}

export interface IUpdateAccount {
  currency?: string;
  balance?: number;
  account_name?: string;
  bank_name?: string;
}

export interface IDeleteAccount {
  accountId: number;
}
