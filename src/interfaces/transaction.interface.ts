export interface ITransaction {
  id: number;
  account_id: number;
  related_account_id?: number;
  related_transaction_id?: number;
  amount: number;
  type: "deposit" | "withdrawal" | "transfer_out" | "transfer_in";
  status: string;
  description?: string;
  created_at: Date;
  updated_at?: Date;
  is_debt?: boolean;
}

export interface IDeposit {
  accountId: number;
  amount: number;
  description?: string;
  is_debt?: boolean;
}

export interface IWithdrawal {
  accountId: number;
  amount: number;
  description?: string;
  is_debt?: boolean;
}

export interface ITransfer {
  fromAccountId: number;
  toAccountId: number;
  amount: number;
  description?: string;
  is_debt?: boolean;
}

export interface ITransactionHistory {
  id: number;
  amount: number;
  type: string;
  status: string;
  description?: string;
  created_at: Date;
  is_debt?: boolean;
  bank_name?: string;
  account_name: string;
  account_currency: string;
  related_account_name?: string;
}

export interface ITransactionHistoryOptions {
  accountId?: number;
  cursor?: string | number;
  limit?: number;
  typeFilter?: "deposit" | "withdrawal" | "transfer_out" | "transfer_in";
  startDate?: string;
  endDate?: string;
  createdAt?: string;
  sortField?: string;
  sortDirection?: "ASC" | "DESC";
}

export interface ITransactionPagination {
  nextCursor: string | number | null;
  hasMore: boolean;
  limit: number;
  sortField: string;
  sortDirection: "ASC" | "DESC";
}
