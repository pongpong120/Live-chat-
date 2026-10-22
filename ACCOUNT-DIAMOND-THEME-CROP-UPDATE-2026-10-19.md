# Account welcome diamonds and profile image features

- New server-created accounts receive 150,000 starting diamonds via `NEW_USER_STARTING_DIAMONDS`.
- The existing profile-photo flow already opens a crop/zoom dialog before upload.
- The existing room-theme flow already supports uploading an image and applying it to a room.
- Automated project tests: 77/77 suites passed after this change.

Important limitation: a strict three-account-per-physical-device anti-clone limit is NOT implemented in this update. Reliable enforcement needs a device-attestation/installation identity strategy plus server-side persistent tracking; browser storage alone is bypassable. Do not describe this build as fully production-ready until that control is implemented and tested.
