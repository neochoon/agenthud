export interface Commit {
  hash: string;
  message: string;
  timestamp: Date;
}

export interface GitStats {
  added: number;
  deleted: number;
}
