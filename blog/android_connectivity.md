# Android Connectivity：蜂窝、Wi-Fi、Bluetooth、GNSS 与 NFC

Android Connectivity 不只是应用调用一个 API。一次连接通常会经过 Framework 服务、原生协议栈、HAL、内核驱动、固件和独立控制器；蜂窝网络还会继续进入基站与核心网。先建立共同分层，再分别理解各条链路，出现问题时才能判断故障属于策略、协议、驱动还是硬件。

# 1. 共同分层与控制面、数据面

多数通信子系统都可以放进下面的结构：

    应用与公开 API
          ↓ Binder
    Framework / System Service
          ↓
    Native 协议栈或守护进程
          ↓
    HAL：Android 与厂商实现之间的稳定边界
          ↓
    内核驱动
          ↓
    设备固件 / Controller / Modem
          ↓
    无线链路、对端设备或运营商网络

各层职责不同：

- Framework Service 管理权限、生命周期、用户策略、网络选择和多应用并发；
- 协议栈实现状态机、报文格式、加密、重传和 Profile 等协议语义；
- HAL 约定 Android 平台如何调用厂商实现，不等同于驱动；
- 内核驱动负责总线、中断、DMA、网络设备和电源管理；
- Firmware 在 Wi-Fi/蓝牙芯片、GNSS 芯片或 Modem 内执行实时控制；
- Controller 是相对独立的协议控制器，例如 Bluetooth Controller、NFCC 或蜂窝 Modem。

还要区分控制面和数据面。控制面负责发现、认证、建链、选网、配置地址和维护状态；数据面负责真正搬运 IP 包、音频帧或应用数据。控制面显示“已连接”，不代表数据面一定可用；数据吞吐异常，也不一定是建链状态机出错。

# 2. Android 网络选择

应用通常通过 ConnectivityManager 描述需要怎样的网络。NetworkRequest 表达请求，NetworkCapabilities 描述网络具备 INTERNET、NOT_METERED、TRANSPORT_WIFI 等哪些能力，LinkProperties 保存接口名、地址、路由、DNS 和代理等链路配置。

Framework 的主要参与者是：

- ConnectivityService：接收网络请求，评分并选择默认网络，管理切换、VPN 和验证状态；
- NetworkAgent：由具体网络实现向 ConnectivityService 报告能力、LinkProperties、分数和状态；
- NetworkStack：负责 DHCP、IP provisioning、网络验证和部分网络监测；
- netd：在 Native 层配置路由、DNS、网络命名空间、UID 规则和防火墙；
- Linux 网络栈：承载 Socket、TCP/UDP/IP、路由、Netfilter/eBPF 与设备驱动。

一条简化数据链路是：

    应用 Socket
      → 绑定的 Android Network
      → Linux 路由 / VPN / UID 策略
      → wlan、rmnet 等网络接口
      → Wi-Fi 芯片或 Modem

网络接入通常要经历“链路建立 → IP 配置 → Internet 验证 → 成为默认网络”。Wi-Fi 已关联到 AP 只说明二层链路建立；DHCP 失败、DNS 不通、门户认证或上游断网都会使它无法成为可用的互联网网络。应用若需要某个指定网络，应通过 Network 对象绑定 Socket，而不是假设全局默认网络永远不变。

# 3. 蜂窝通信

## 3.1 分层

    Telephony API / Telecom API
              ↓
    Telephony Framework、Subscription、IMS
              ↓
    Radio HAL / RIL
              ↓
    厂商 Radio 实现
              ↓
    Baseband / Modem
              ↓
    基站 RAN
              ↓
    运营商 Core Network

Telephony Framework 管理 SIM/eSIM、订阅、运营商配置、网络注册、通话和数据业务。Radio HAL 是 Framework 与厂商无线实现之间的接口；RIL 一词常同时出现在 Framework 侧请求分发和厂商 Radio 实现的历史语境中。Modem/Baseband 运行蜂窝协议栈，与 Android 应用处理器相对独立。

IMS 是基于 IP 的多媒体业务体系。Android 侧 ImsService 连接平台与运营商或厂商 IMS 实现，承载 VoLTE/VoNR 语音、IMS 短信以及部分多媒体通信能力。电话语音、短信和移动数据虽然都使用蜂窝系统，却有不同的注册与承载状态，不能由“数据能上网”推导“IMS 一定正常”。

## 3.2 从开机到移动数据可用

主要阶段可以概括为：

1. 识别 SIM/eSIM 和 Subscription；
2. 搜索 PLMN，完成鉴权并注册到网络；
3. 根据运营商配置选择 APN；
4. Modem 建立数据承载并返回地址、DNS、网关等信息；
5. Android 创建 rmnet 等数据接口和 NetworkAgent；
6. ConnectivityService 验证网络并决定是否作为默认网络。

APN 描述接入用途和运营商参数；不同 APN 可分别用于默认数据、IMS、彩信或紧急业务。漫游、双卡、弱信号、运营商策略和基站切换都会改变状态机，不能只观察一个 signal strength 数字。

## 3.3 定位故障

- 无 SIM/订阅：先看 UICC、eSIM profile 与 Subscription 状态；
- 无服务：检查 PLMN 搜索、拒绝原因、频段和射频状态；
- 已注册但无数据：检查 APN、data call、rmnet、地址和路由；
- 有地址但不能联网：检查 DNS、网络验证、VPN 与运营商侧限制；
- 数据正常但通话异常：单独检查 IMS 注册、MmTel 能力、承载和呼叫状态；
- 偶发断连：对齐 Framework、Radio log、Modem log 与基站切换时间。

常用入口：

    adb shell dumpsys telephony.registry
    adb shell dumpsys isub
    adb shell dumpsys connectivity
    adb logcat -b radio
    adb shell ip addr
    adb shell ip route

量产设备可见信息会受到权限和厂商日志策略限制。

# 4. Wi-Fi

## 4.1 分层

    android.net.wifi API
            ↓
    Wi-Fi Framework Service
            ↓
    wificond / supplicant / hostapd
            ↓
    Wi-Fi HAL
            ↓
    nl80211 / cfg80211 / mac80211
            ↓
    Vendor Driver + Firmware
            ↓
    Wi-Fi Chip

wificond 通过 nl80211 与内核 Wi-Fi 子系统通信，负责扫描等底层控制。Supplicant 完成 STA 模式下的认证和关联状态机，hostapd 管理 SoftAP。Vendor HAL 暴露厂商芯片能力和控制接口。cfg80211 提供 Linux 无线配置框架；某些驱动使用 mac80211 软件 MAC 框架，FullMAC 驱动则把更多 MAC 功能放在固件中。

## 4.2 一次连接的阶段

    扫描
      → 候选网络选择
      → 认证
      → Association
      → 四次握手与密钥安装
      → DHCP / IPv6 配置
      → DNS 与 Internet 验证

扫描可发现 AP，不代表认证一定成功；Association 成功只建立二层连接；拿到 IP 也不代表 DNS 和公网可达。排障时应明确失败发生在哪个阶段。

Android Wi-Fi 还包括：

- STA：作为客户端连接 AP；
- SoftAP：设备自身提供热点；
- Wi-Fi Direct：设备间点对点连接；
- Wi-Fi Aware：邻近设备发现和数据路径；
- Wi-Fi RTT：基于往返时间进行距离测量；
- 多接口并发：同时维持 STA、热点、P2P 等组合，能力取决于芯片和 HAL。

## 4.3 漫游、吞吐和功耗

漫游不是简单地选择 RSSI 最大的 AP。系统还要考虑当前链路质量、候选 AP、扫描成本、切换迟滞、认证方式和业务连续性。切换过慢会长期停留在弱 AP，过于激进又会来回抖动。

吞吐下降可以沿以下链路拆分：

- 射频：RSSI、SNR、干扰、信道宽度、MCS；
- MAC：重传、聚合效率、空口竞争和省电模式；
- Driver/Firmware：队列、IRQ、NAPI、功耗状态和固件异常；
- IP：丢包、拥塞窗口、MTU、路由和 VPN；
- 应用：小包、串行请求、线程调度和错误重试。

持续扫描、保持高性能模式和高频小包会增加耗电。批量扫描、合理心跳、让无线链路进入省电状态通常更有效，但会与发现时延和消息实时性形成权衡。

常用入口：

    adb shell dumpsys wifi
    adb shell dumpsys connectivity
    adb shell cmd wifi status
    adb shell ip link
    adb shell ip route
    adb shell ping <gateway>

# 5. Bluetooth

## 5.1 Host 与 Controller

    Bluetooth API / Profiles
              ↓ Binder
    Bluetooth System App / Service
              ↓ JNI
    AOSP Bluetooth Host Stack
              ↓ HAL / HCI
    Bluetooth Controller + Firmware
              ↓
    2.4 GHz Radio

Host 运行在应用处理器上，负责 Profile、L2CAP、ATT/GATT、SMP 等上层协议；Controller 负责链路层、基带和射频。HCI 是 Host 与 Controller 之间的命令、事件和数据接口，底层传输可能是 UART、USB 或共享内存。

Bluetooth Classic 适合持续音频、传统外设和较高吞吐场景；Bluetooth Low Energy 以低功耗发现和短数据交换为核心。BLE 应用数据通常建立在 ATT/GATT 上：

- Attribute 是有句柄和权限的数据项；
- Service 组织一组能力；
- Characteristic 表示可读、可写或可通知的数据；
- GATT Client 发起发现和访问，GATT Server 保存属性数据库；
- Notification 不要求客户端逐次确认，Indication 需要协议确认。

Classic 常见 Profile 包括 A2DP 音频、HFP 免提和 HID 输入设备。Profile 不只是数据格式，还定义角色、状态机和底层协议组合。

## 5.2 不要混淆的状态

- Discovery/Scanning：发现附近设备或广播；
- Pairing：完成身份确认和密钥协商过程；
- Bonding：把长期密钥保存起来，后续可恢复信任关系；
- Encryption：当前链路已经启用加密；
- Connected：某条 ACL 或 LE 链路建立；
- Profile Connected：具体 A2DP、HFP 或 GATT 业务已经可用。

“已配对”不等于当前已连接，“ACL 已连接”也不等于某个 Profile 完成初始化。BLE 还要考虑连接间隔、Slave Latency、PHY、MTU 和通知频率，它们共同影响时延、吞吐与功耗。

常用入口：

    adb shell dumpsys bluetooth_manager
    adb shell dumpsys bluetooth
    adb logcat -b main -b system

复杂问题需要同时对齐 Framework log、btsnoop/HCI snoop、Host Stack、HAL 和 Controller 事件。抓取蓝牙报文可能包含设备身份和业务数据，应遵循设备与数据安全要求。

# 6. GNSS 与 Android Location

GPS 是美国的全球定位卫星系统；GNSS 是包括 GPS、北斗、Galileo、GLONASS 等在内的统称。Android Location 还可融合 Wi-Fi、蜂窝、蓝牙和惯性传感器，因此 Location 结果不必然由 GNSS 单独产生。

    Location API
        ↓
    Location Framework / Provider
        ↓
    GNSS HAL
        ↓
    Vendor GNSS Engine / Firmware
        ↓
    RF Front-end + Antenna
        ↓
    GNSS Satellites

GNSS HAL 与 Sensors HAL 是不同接口。加速度计和陀螺仪可以辅助融合定位，但卫星测量、星历、时钟和 GNSS 状态由 GNSS 链路提供。

## 6.1 TTFF、辅助定位和精度

TTFF 是 Time To First Fix，即从请求定位到得到首次有效位置的时间。冷启动时接收机缺少时间、位置、星历等信息，耗时通常更长；A-GNSS 可通过网络提供辅助数据，缩短首次定位时间。网络不可用、辅助数据过期、天线环境差和系统时间异常都可能拉长 TTFF。

定位质量受卫星几何分布、遮挡、多路径、射频干扰、时钟误差和融合算法影响。卫星数量多不一定代表精度一定高；高楼附近反射形成的多路径常比单纯弱信号更难处理。

连续高频定位会保持 GNSS、CPU 与网络活跃。Framework 可通过请求间隔、批处理和低功耗 Provider 在精度、更新频率与耗电之间取舍。应用不应在后台无限持有最高频请求。

常用入口：

    adb shell dumpsys location
    adb shell dumpsys sensorservice
    adb logcat | grep -i gnss

排障时分别确认请求是否到达 Framework、Provider 是否启用、HAL 是否收到请求、是否有卫星测量、首次 Fix 时间和最终融合结果，避免把权限或位置开关问题误判为射频问题。

# 7. NFC

    NFC API
       ↓
    NfcService
       ↓
    Native NFC Stack
       ↓
    NFC HAL
       ↓ NCI
    NFCC / Secure Element
       ↓
    RF Field、Tag 或 Reader

NFCC 是 NFC Controller。NCI 是 Host 与 NFCC 之间的标准控制接口，承担初始化、发现、激活和数据交换命令。Secure Element 是可选的安全执行环境，可位于 eSE、SIM 等位置；HCE 则由 Android 应用在 Host 上模拟卡片能力。

常见工作模式：

- Reader/Writer：读取或写入 NFC Tag，常见数据格式是 NDEF；
- Card Emulation：设备表现为非接触卡，可由 HCE 或 Secure Element 承载；
- Device discovery：轮询不同技术类型，发现目标后完成协议激活。

一次交互通常经过：

    打开 Controller
      → 配置发现技术和路由
      → RF Discovery
      → Select / Activate
      → 交换 APDU 或 Tag 数据
      → Deactivate

HCE 中 AID 路由决定某类 APDU 发给哪个服务。卡模拟异常要区分默认支付/路由策略、应用服务生命周期、AID 冲突、NCI 状态和射频场强。安全业务还要考虑设备解锁要求、用户确认和密钥是否位于真正的 Secure Element 中。

常用入口：

    adb shell dumpsys nfc
    adb logcat | grep -i nfc

# 8. 设备互联协议如何选

互联功能一般包含发现、认证、会话建立、数据传输、保活、重连和版本协商，不应直接从“选 Bluetooth 还是 Wi-Fi”开始。

| 能力 | 适合场景 | 主要限制 |
|---|---|---|
| BLE | 低功耗发现、控制、小数据 | 吞吐和包长有限，连接参数影响时延 |
| Bluetooth Classic | 音频、传统外设、连续连接 | 功耗通常高于 BLE，Profile 约束明显 |
| Wi-Fi Direct | 邻近设备大数据传输 | 组网和并发策略较复杂 |
| Wi-Fi Aware | 无 AP 的邻近发现和数据路径 | 设备能力与兼容性需要确认 |
| 局域网 IP | 已在同一网络内的高速互联 | 受 AP 隔离、组播策略和网络切换影响 |
| 蜂窝/互联网 | 跨距离、经云端中转 | 时延、流量、弱网与服务器可用性 |
| NFC | 近距离触碰、引导配对、凭证 | 距离和吞吐很小 |
| UWB | 高精度测距和方向感知 | 主要解决测距，不适合承载大数据 |

协议本身还需要：

- 明确长度、版本、消息类型和校验，避免粘包与半包歧义；
- 使用 TLS、Noise 等经过验证的安全协议，不自创加密；
- 对重复请求设计 request ID 和幂等语义；
- 使用窗口、队列上限和 backpressure 防止快发送方压垮接收方；
- 把连接存活与业务成功分开，设计超时、退避、重连和断点续传；
- 在双方版本不一致时协商能力，而不是依赖固定设备型号。

# 9. 跨层排障闭环

先保存一条可复现的时间线：

1. 记录操作步骤、设备状态、网络环境和精确时间；
2. 用 dumpsys 保存 Framework 状态，用 logcat/bugreport 保存系统事件；
3. 确认失败属于发现、认证、建链、配置、验证还是业务传输；
4. 沿 Binder、HAL、驱动和 Firmware 对齐同一个请求或连接 ID；
5. 使用 Perfetto 检查关键线程调度、Binder、IRQ、频率和等待；
6. 使用协议抓包确认报文是否发出、对端是否响应以及重试发生在哪层；
7. 修改一个变量后重复测试，并比较成功率、P95 时延、功耗和异常恢复。

状态异常与性能异常要分开处理。“连接不上”优先检查状态机和协议错误；“能连但慢”再分析空口、队列、CPU、内存、IRQ 和应用数据模式。只靠 UI 图标、单条 log 或一次吞吐结果，通常无法建立根因。

# 10. 稳定性、功耗与安全

- 生命周期：飞行模式、用户切换、休眠、进程重启和固件恢复后状态必须可重建；
- 并发：热点与 STA、双卡、多个蓝牙 Profile、定位与扫描可能争抢硬件资源；
- 功耗：扫描、心跳、高定位频率和错误重试都可能阻止系统休眠；
- 超时：每层都设超时会形成放大效应，应明确由哪层负责重试；
- 隐私：MAC、位置、SSID、基站、设备标识和抓包内容都可能是敏感数据；
- 权限：Framework 权限、AppOps、SELinux、HAL 服务权限和驱动节点权限缺一不可；
- 恢复：固件崩溃后需要区分子系统重启、接口重建和应用状态通知，不能留下“Framework 认为已连接、硬件已复位”的分裂状态。

# 参考资料

1. [AOSP: Wi-Fi architecture overview](https://source.android.com/docs/core/connect/wifi-overview)
2. [AOSP: Wi-Fi HAL](https://source.android.com/docs/core/connect/wifi-hal)
3. [AOSP: Bluetooth architecture](https://source.android.com/docs/core/connect/bluetooth)
4. [AOSP: Bluetooth Low Energy](https://source.android.com/docs/core/connect/bluetooth/ble)
5. [AOSP: Radio interface layer](https://source.android.com/docs/core/connect/ril)
6. [AOSP: IMS service](https://source.android.com/docs/core/connect/ims)
7. [Android Developers: ConnectivityManager](https://developer.android.com/reference/android/net/ConnectivityManager)
8. [Android Developers: Location and sensors](https://developer.android.com/develop/sensors-and-location/location)
9. [Android Developers: NFC basics](https://developer.android.com/develop/connectivity/nfc)
10. [AOSP: Android proprietary NCI commands](https://source.android.com/docs/core/connect/android-proprietary-nci-commands)
