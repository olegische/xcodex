export type ThreadSummary = {
  id: string;
  title: string;
  subtitle: string;
  active: boolean;
};

export type PendingApproval = {
  id: string;
  title: string;
  detail: string;
  status: "observed";
};
