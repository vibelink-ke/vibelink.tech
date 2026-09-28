# TR-069 research (for the build)

Written 2026-09-26. Sources at the end. Things marked (verify) are from memory or general knowledge and need a check against a real ONU before we rely on them.

## What TR-069 is, in one paragraph

A CPE (ONU, router) calls an ACS (auto-configuration server) over HTTP/SOAP (CWMP). The CPE always starts the session: at boot, on a timer ("periodic inform"), and when the ACS pokes it with a **connection request**. Over the session the ACS reads and writes parameters in a data model (TR-098 `InternetGatewayDevice.*` on older devices, TR-181 `Device.*` on newer ones), and can reboot, factory-reset, upload/download files and firmware. It is how we would set WiFi name/password, PPPoE credentials and read live status (WAN IP, WiFi clients, optical signal on some models) without anyone logging in to the device.

## Two ways to get it

### A. Use SmartOLT's built-in ACS (least to build)
- SmartOLT already ships a TR-069/TR-098/TR-181 ACS at no extra cost, and we already talk to SmartOLT's API.
- Their API has `enable_tr069` / `disable_tr069` (needs a `tr069_profile` name, `tr069_interface` mgmt or wan), `set_onu_wan_configuration_method` (OMCI or TR069), `set_onu_wan_mode_pppoe` (has `configuration_method`), and `set_wifi_port_*` (SSID, password, auth mode).
- Requirements on the ISP side (from SmartOLT's setup page): a **VPN tunnel from the ISP's MikroTik to SmartOLT is mandatory**; a management/VoIP VLAN on the OLT uplink and on the MikroTik with a gateway IP; an ONU management IP pool (DHCP on the MikroTik is allowed, some ONUs need static); a TR069 profile attached to the OLT (Settings → VPN & TR069).
- Limits: only what SmartOLT's API exposes; per-ONU calls are rate-limited on their side; it only covers ONUs that sit on an OLT SmartOLT manages. No access to routers/CPE that are not ONUs.

### B. Run our own ACS (GenieACS) (most control)
- GenieACS is the usual open-source ACS: four services sharing one **MongoDB**: CWMP (7547, what devices call), NBI (7557, REST API for us), FS (7567, firmware/config files), UI (3000).
- **Provisions/presets**: scripted rules that run when a device informs (e.g. "on first boot, set ACS creds, WiFi, PPPoE from our billing"). **Tasks** through the NBI: `setParameterValues`, `getParameterValues`, `refreshObject`, `reboot`, `factoryReset`, `download`; can run synchronously with a connection request.
- New moving parts for this stack: a MongoDB container, GenieACS containers, a reachable CWMP port (devices must be able to reach the ACS URL from their management network), an auth scheme for the ACS and for connection requests (`cwmp.auth`, `cwmp.connectionRequestAuth`).
- Connection requests need the ACS to reach the CPE's IP. Behind NAT/CGNAT that fails, so use the management VLAN (private, routable from the ACS over WireGuard) or STUN/UDP connection requests.

## What we would build either way (the product side)
1. **Device inventory**: which ONU/router belongs to which customer (we already link ONUs by serial; TR-069 devices identify themselves by OUI + serial + product class).
2. **Provisioning on first contact**: WiFi name/password and PPPoE username/password from the customer record; message the customer the WiFi details (the SmartOLT authorise form already does this over OMCI; TR-069 would be the fallback for ONUs where OMCI can't set WiFi).
3. **Actions on the client page**: change WiFi name/password, reboot, factory reset, "refresh status".
4. **Read-only status**: WAN IP, uptime, WiFi clients, and optical power where the model reports it.
5. **Fixing the class of fault we hit on 26 Sept**: an ONU that dials but sends nothing (WAN not bound to LAN/WiFi, wrong mode) can be diagnosed and corrected remotely.

## Data-model paths we will need (verify on the real models)
| What | TR-098 (older) | TR-181 (newer) |
|---|---|---|
| WiFi name | `InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID` | `Device.WiFi.SSID.1.SSID` |
| WiFi password | `...WLANConfiguration.1.PreSharedKey.1.KeyPassphrase` | `Device.WiFi.AccessPoint.1.Security.KeyPassphrase` |
| PPPoE user/pass | `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username / Password` | `Device.PPP.Interface.1.Username / Password` |
| Reboot / reset | `Reboot` and `FactoryReset` RPCs (not parameters) | same |
The exact instance numbers differ per vendor (Huawei, ZTE, Tenda, Nokia, TP-Link…). 5 GHz is usually another WLANConfiguration instance (e.g. 5) (verify).

## Decisions for tomorrow
1. **SmartOLT ACS or GenieACS?** SmartOLT's is quickest but tied to their VPN and API limits, and only covers ONUs on their OLTs. GenieACS is more work but works for any TR-069 CPE and gives us full control. A reasonable path: start with GenieACS in the .co.ke stack (single ISP, easy to test), keep SmartOLT for OLT/ONU authorisation.
2. **Which repo?** `.co.ke` is a single business; `billing.tech` is multi-tenant. A multi-tenant ACS means mapping each device to a tenant (by serial/OUI, or by ACS credentials per tenant) and keeping tenants' devices apart. Suggest .co.ke first (matches how the field app was scoped), tenants later.
3. **Reachability**: where does the management VLAN live, and how do ONUs reach the ACS (through the MikroTik and the WireGuard link to vm495gisp)? Which port do we expose, and behind what auth?
4. **Which ONU models are on the network** (make and model list)? Their data model and TR-069 quirks decide the parameter map above.
5. **Security**: ACS credentials per device or shared, TLS on the CWMP port (many ONUs do not verify certs), never expose the NBI (7557) or the UI (3000) publicly, put them behind our own auth only.

## Questions to ask the user before starting
- Which ONU/CPE models are deployed (Huawei EG8145, ZTE F660/F670, others)?
- Are the ONUs already on a management VLAN with an IP, and is TR-069 already enabled on any of them from SmartOLT?
- One-off setup for .co.ke first, or straight to multi-tenant?
- Main goal: WiFi/PPPoE provisioning, remote reboot/reset, or status and diagnostics?

## Sources
- GenieACS architecture: https://github.com/genieacs/genieacs/blob/master/ARCHITECTURE.md
- GenieACS project: https://github.com/genieacs/genieacs
- GenieACS with ONTs (auth keys, ONT ACS settings): https://www.telecomate.com/tr069-management-maintening-ont-through-genieacs/
- SmartOLT TR069 setup: https://www.smartolt.com/setup_instructions_tr069.html
- SmartOLT public API collection (endpoints listed above): https://api.smartolt.com/
- ISP-oriented overview: https://ispbills.com/blog/tr069-acs-cpe-management-isp/
