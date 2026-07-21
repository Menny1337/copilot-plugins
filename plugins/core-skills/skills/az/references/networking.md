
# Azure Networking Skill

## When to Use

- Managing Azure networking resources: VNets, subnets, NSGs, DNS, private endpoints, load balancers, VPN gateways, route tables, and related infrastructure.
- Any task involving `az network` subcommands.

## When to Skip

- **CDN / Front Door** — Separate domain; use az-cdn or az-frontdoor skills.
- **Application-level routing** — App Service routing, container ingress, or API Management policies are not networking-layer concerns.

## Prerequisites

- Invoke the **Foundations** section in the az skill first to ensure CLI is authenticated, the correct subscription is set, and resource group conventions are established.
- `az extension add --name <ext>` if a preview extension is required (e.g., `private-dns`).


## Virtual Networks

Core building block. A VNet defines an address space; subnets partition it.

```bash
# Create a VNet
az network vnet create \
  --resource-group $RG --name $VNET \
  --address-prefixes 10.0.0.0/16 \
  --location $LOCATION

# Add a subnet
az network vnet subnet create \
  --resource-group $RG --vnet-name $VNET \
  --name $SUBNET --address-prefixes 10.0.1.0/24

# List / show / update / delete
az network vnet list -g $RG -o table
az network vnet show -g $RG -n $VNET
az network vnet update -g $RG -n $VNET --address-prefixes 10.0.0.0/16 10.1.0.0/16
az network vnet delete -g $RG -n $VNET

# Subnet management
az network vnet subnet list -g $RG --vnet-name $VNET -o table
az network vnet subnet show -g $RG --vnet-name $VNET -n $SUBNET
az network vnet subnet update -g $RG --vnet-name $VNET -n $SUBNET \
  --network-security-group $NSG_NAME
az network vnet subnet delete -g $RG --vnet-name $VNET -n $SUBNET

# VNet peering
az network vnet peering create \
  --resource-group $RG --name peer-a-to-b \
  --vnet-name $VNET_A --remote-vnet $VNET_B_ID \
  --allow-vnet-access true
```


## NSGs & Security Rules

Network Security Groups filter traffic at the subnet or NIC level.

```bash
# Create an NSG
az network nsg create --resource-group $RG --name $NSG

# List / show / update / delete
az network nsg list -g $RG -o table
az network nsg show -g $RG -n $NSG
az network nsg update -g $RG -n $NSG --tags env=prod
az network nsg delete -g $RG -n $NSG

# Add a security rule
az network nsg rule create \
  --resource-group $RG --nsg-name $NSG \
  --name AllowHTTPS \
  --priority 100 \
  --direction Inbound --access Allow \
  --protocol Tcp --destination-port-ranges 443 \
  --source-address-prefixes '*' --destination-address-prefixes '*'

# List / show / update / delete rules
az network nsg rule list -g $RG --nsg-name $NSG -o table
az network nsg rule show -g $RG --nsg-name $NSG -n AllowHTTPS
az network nsg rule update -g $RG --nsg-name $NSG -n AllowHTTPS --priority 110
az network nsg rule delete -g $RG --nsg-name $NSG -n AllowHTTPS

# Associate NSG with a subnet
az network vnet subnet update \
  --resource-group $RG --vnet-name $VNET --name $SUBNET \
  --network-security-group $NSG
```


## Public IPs

```bash
az network public-ip create \
  --resource-group $RG --name $PIP \
  --sku Standard --allocation-method Static

az network public-ip list -g $RG -o table
az network public-ip show -g $RG -n $PIP
az network public-ip update -g $RG -n $PIP --tags env=prod
az network public-ip delete -g $RG -n $PIP
```

Always use **Standard SKU** for production — Basic is being retired.


## Network Interfaces

```bash
az network nic create \
  --resource-group $RG --name $NIC \
  --vnet-name $VNET --subnet $SUBNET \
  --network-security-group $NSG \
  --public-ip-address $PIP

az network nic list -g $RG -o table
az network nic show -g $RG -n $NIC
az network nic update -g $RG -n $NIC --ip-forwarding true
az network nic delete -g $RG -n $NIC
```


## Load Balancers

Layer 4 load balancing. Use Standard SKU for production.

```bash
# Create a public load balancer
az network lb create \
  --resource-group $RG --name $LB \
  --sku Standard --frontend-ip-name $FE_IP \
  --public-ip-address $PIP \
  --backend-pool-name $BACKEND_POOL

# Health probe
az network lb probe create \
  --resource-group $RG --lb-name $LB \
  --name httpProbe --protocol Tcp --port 80

# Load balancing rule
az network lb rule create \
  --resource-group $RG --lb-name $LB \
  --name httpRule --protocol Tcp \
  --frontend-port 80 --backend-port 80 \
  --frontend-ip-name $FE_IP \
  --backend-pool-name $BACKEND_POOL \
  --probe-name httpProbe

# Manage backend pool addresses
az network lb address-pool address add \
  --resource-group $RG --lb-name $LB \
  --pool-name $BACKEND_POOL --name addr1 \
  --vnet $VNET --ip-address 10.0.1.4

# List / show / delete
az network lb list -g $RG -o table
az network lb show -g $RG -n $LB
az network lb delete -g $RG -n $LB
```


## Application Gateways

Layer 7 (HTTP/HTTPS) load balancing with WAF, SSL termination, and path-based routing. Configuration is complex — prefer Bicep/Terraform for production; use CLI for quick setups.

```bash
# Minimal create (requires a dedicated subnet)
az network application-gateway create \
  --resource-group $RG --name $APPGW \
  --sku Standard_v2 --capacity 2 \
  --vnet-name $VNET --subnet $APPGW_SUBNET \
  --public-ip-address $PIP \
  --http-settings-port 80 --http-settings-protocol Http \
  --frontend-port 80 --routing-rule-type Basic

az network application-gateway list -g $RG -o table
az network application-gateway show -g $RG -n $APPGW
az network application-gateway delete -g $RG -n $APPGW
```


## DNS

### Public DNS

```bash
# Zone management
az network dns zone create --resource-group $RG --name contoso.com
az network dns zone list -g $RG -o table
az network dns zone show -g $RG -n contoso.com
az network dns zone delete -g $RG -n contoso.com

# Record sets
az network dns record-set a add-record \
  --resource-group $RG --zone-name contoso.com \
  --record-set-name www --ipv4-address 1.2.3.4

az network dns record-set a list -g $RG --zone-name contoso.com -o table
az network dns record-set cname set-record \
  --resource-group $RG --zone-name contoso.com \
  --record-set-name api --cname api.azurewebsites.net

az network dns record-set a remove-record \
  --resource-group $RG --zone-name contoso.com \
  --record-set-name www --ipv4-address 1.2.3.4
```

### Private DNS

```bash
# Zone
az network private-dns zone create --resource-group $RG --name privatelink.database.windows.net
az network private-dns zone list -g $RG -o table

# Link zone to VNet (required for resolution)
az network private-dns link vnet create \
  --resource-group $RG --zone-name privatelink.database.windows.net \
  --name myVNetLink --virtual-network $VNET \
  --registration-enabled false

# Records
az network private-dns record-set a add-record \
  --resource-group $RG --zone-name privatelink.database.windows.net \
  --record-set-name mydb --ipv4-address 10.0.1.5

az network private-dns link vnet list -g $RG --zone-name privatelink.database.windows.net -o table
```


## Private Endpoints

Connect to Azure PaaS services over a private IP in your VNet.

```bash
# Create a private endpoint (e.g., for a storage account)
az network private-endpoint create \
  --resource-group $RG --name $PE_NAME \
  --vnet-name $VNET --subnet $SUBNET \
  --private-connection-resource-id $STORAGE_ACCOUNT_ID \
  --group-ids blob \
  --connection-name myConnection

az network private-endpoint list -g $RG -o table
az network private-endpoint show -g $RG -n $PE_NAME
az network private-endpoint delete -g $RG -n $PE_NAME

# DNS zone group (auto-registers DNS in private DNS zone)
az network private-endpoint dns-zone-group create \
  --resource-group $RG --endpoint-name $PE_NAME \
  --name default --zone-name privatelink.blob.core.windows.net \
  --private-dns-zone $PRIVATE_DNS_ZONE_ID
```

### Private Link Service

Expose your own service behind a private endpoint for consumers.

```bash
az network private-link-service create \
  --resource-group $RG --name $PLS_NAME \
  --vnet-name $VNET --subnet $SUBNET \
  --lb-name $LB --lb-frontend-ip-configs $FE_IP \
  --location $LOCATION

az network private-link-service list -g $RG -o table
az network private-link-service show -g $RG -n $PLS_NAME
az network private-link-service delete -g $RG -n $PLS_NAME
```


## VPN & ExpressRoute

### VPN Gateway

```bash
# Create a gateway subnet first
az network vnet subnet create \
  --resource-group $RG --vnet-name $VNET \
  --name GatewaySubnet --address-prefixes 10.0.255.0/27

# Create VPN gateway (takes 30-45 minutes)
az network vnet-gateway create \
  --resource-group $RG --name $VPN_GW \
  --vnet $VNET --gateway-type Vpn --vpn-type RouteBased \
  --sku VpnGw1 --public-ip-addresses $PIP \
  --no-wait

# Site-to-site connection
az network vpn-connection create \
  --resource-group $RG --name $VPN_CONN \
  --vnet-gateway1 $VPN_GW \
  --local-gateway2 $LOCAL_GW \
  --shared-key $SHARED_KEY

az network vnet-gateway list -g $RG -o table
az network vpn-connection show -g $RG -n $VPN_CONN
```

### ExpressRoute

```bash
az network express-route create \
  --resource-group $RG --name $ER_CIRCUIT \
  --bandwidth 50 --peering-location "Silicon Valley" \
  --provider "Equinix" --sku-family MeteredData --sku-tier Standard

az network express-route list -g $RG -o table
az network express-route show -g $RG -n $ER_CIRCUIT
az network express-route delete -g $RG -n $ER_CIRCUIT
```


## NAT Gateways

Provide outbound internet connectivity for VMs in a subnet without public IPs.

```bash
az network nat gateway create \
  --resource-group $RG --name $NAT_GW \
  --public-ip-addresses $PIP --idle-timeout 10

# Associate with a subnet
az network vnet subnet update \
  --resource-group $RG --vnet-name $VNET --name $SUBNET \
  --nat-gateway $NAT_GW

az network nat gateway list -g $RG -o table
az network nat gateway show -g $RG -n $NAT_GW
az network nat gateway update -g $RG -n $NAT_GW --idle-timeout 15
az network nat gateway delete -g $RG -n $NAT_GW
```


## Traffic Manager

DNS-based global traffic routing across regions.

```bash
# Profile
az network traffic-manager profile create \
  --resource-group $RG --name $TM_PROFILE \
  --routing-method Performance \
  --unique-dns-name $TM_DNS

# Endpoints
az network traffic-manager endpoint create \
  --resource-group $RG --profile-name $TM_PROFILE \
  --name eastus-ep --type azureEndpoints \
  --target-resource-id $PUBLIC_IP_EASTUS

az network traffic-manager profile list -g $RG -o table
az network traffic-manager profile show -g $RG -n $TM_PROFILE
az network traffic-manager endpoint list -g $RG --profile-name $TM_PROFILE -o table
az network traffic-manager profile delete -g $RG -n $TM_PROFILE
```


## Network Watcher

Diagnostic tools for network troubleshooting.

```bash
# IP flow verify — check if traffic is allowed/denied
az network watcher test-ip-flow \
  --direction Inbound --protocol Tcp \
  --local 10.0.1.4:80 --remote 203.0.113.5:12345 \
  --vm $VM_ID --nic $NIC_ID

# Next hop
az network watcher show-next-hop \
  --resource-group $RG --vm $VM_NAME \
  --source-ip 10.0.1.4 --dest-ip 10.0.2.4

# Topology
az network watcher show-topology --resource-group $RG

# Connection monitor
az network watcher connection-monitor create \
  --name $MONITOR --resource-group $RG \
  --location $LOCATION
```


## Route Tables

User-defined routes (UDRs) override Azure's default system routes.

```bash
az network route-table create --resource-group $RG --name $RT

# Add a route (e.g., force traffic through an NVA)
az network route-table route create \
  --resource-group $RG --route-table-name $RT \
  --name toNVA --address-prefix 10.1.0.0/16 \
  --next-hop-type VirtualAppliance --next-hop-ip-address 10.0.2.4

# Associate with subnet
az network vnet subnet update \
  --resource-group $RG --vnet-name $VNET --name $SUBNET \
  --route-table $RT

az network route-table list -g $RG -o table
az network route-table route list -g $RG --route-table-name $RT -o table
az network route-table show -g $RG -n $RT
az network route-table delete -g $RG -n $RT
```


## Gotchas

| Topic | Detail |
|---|---|
| **NSG rule priority** | Lower number = higher priority. Azure evaluates rules in priority order and stops at the first match. Use increments of 10 or 100 for easy insertion. |
| **NSG vs ASG** | NSGs filter by IP/port. Application Security Groups (ASGs) let you group NICs logically and reference them in NSG rules instead of IPs — cleaner for dynamic environments. |
| **Private endpoint DNS** | Creating a private endpoint does NOT automatically configure DNS. You must either use a private DNS zone with a VNet link or configure custom DNS. Use `dns-zone-group` for automatic registration. |
| **Subnet delegation** | Some services (e.g., App Service, Container Instances) require subnet delegation (`--delegations Microsoft.Web/serverFarms`). A delegated subnet can only host that service type. |
| **GatewaySubnet** | Must be named exactly `GatewaySubnet` for VPN/ExpressRoute gateways. Minimum /27 recommended. |
| **Standard vs Basic SKU** | Standard SKU public IPs, load balancers, and NAT gateways are zone-aware and required for production. Basic SKU is being retired. |
| **Peering is not transitive** | VNet A peered with B, and B peered with C, does NOT mean A can reach C. Use hub-spoke with a gateway or Azure Virtual WAN. |


## Reference

- [Azure Networking CLI reference](https://learn.microsoft.com/cli/azure/network)
- [Virtual Network overview](https://learn.microsoft.com/azure/virtual-network/virtual-networks-overview)
- [NSG overview](https://learn.microsoft.com/azure/virtual-network/network-security-groups-overview)
- [Private Link / Private Endpoints](https://learn.microsoft.com/azure/private-link/private-endpoint-overview)
- [Azure DNS](https://learn.microsoft.com/azure/dns/dns-overview)
- [Load Balancer](https://learn.microsoft.com/azure/load-balancer/load-balancer-overview)
- [VPN Gateway](https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-about-vpngateways)
- [ExpressRoute](https://learn.microsoft.com/azure/expressroute/expressroute-introduction)
- [Network Watcher](https://learn.microsoft.com/azure/network-watcher/network-watcher-monitoring-overview)
