# Agency Control Center — Production Flow

## Agency removal / termination

When Control Panel removes or terminates an Agency:

- The Agency remains as a soft-deleted audit/report record.
- `agency.hostIds` is cleared.
- Every former Host has `agencyId` removed and `isHost=false`.
- Host clients receive `host-status-update` so Host Center state is invalidated immediately.
- Agency Owner membership is detached without marking the owner as a Host.
- The action is RBAC/country scoped and audited.

## Host removal

`POST /api/admin/agency/:agencyId/remove-host`

Removes one Host from the selected Agency and clears that user's live Agency/Host membership. Historical gifts remain unchanged.

## Host transfer

`POST /api/admin/agency/:agencyId/transfer-host`

Body:

```json
{
  "hostUserId": "HOST_USER_ID",
  "targetAgencyId": "TARGET_AGENCY_ID"
}
```

Rules:

- Source and target must be different active Agencies.
- Both Agencies must be inside the acting Admin's country scope.
- Source and target must be in the same country.
- The Host must currently belong to the source Agency.
- Agency Owners cannot be transferred as Hosts.
- Duplicate target membership is rejected.
- The user's `agencyId` is moved to the target and `isHost` remains true.
- Source/target membership and the user membership are persisted together in the normal server write path.
- Transfer activity is recorded for audit visibility.
- Host and both Agency Owners receive live membership updates.

The Control Panel Agency Command Center exposes a target-Agency selector and a **Transfer** action beside every live Host.
