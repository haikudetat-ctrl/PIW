-- Refresh the Data API schema cache after installing the campaign intake RPC.
-- PostgreSQL delivers NOTIFY at transaction commit, after the function is visible.
notify pgrst, 'reload schema';
