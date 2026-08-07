ALTER TABLE "data_rights_deletion_receipts"
  DROP CONSTRAINT "data_rights_deletion_receipts_disposition_check",
  ADD CONSTRAINT "data_rights_deletion_receipts_disposition_check"
    CHECK ("disposition" IN ('erased', 'anonymized', 'retained_minimal', 'externally_erased'));
