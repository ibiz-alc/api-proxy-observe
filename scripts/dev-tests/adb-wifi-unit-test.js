#!/usr/bin/env node
// unit-test ของ adb-wifi.js (logic ล้วน ไม่ต้องมีมือถือ/เซิร์ฟเวอร์)   node scripts/dev-tests/adb-wifi-unit-test.js
const w = require('../../adb-wifi');
let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  if (!ok) failed++;
};
eq('isWifiSerial ip:port', w.isWifiSerial('192.168.1.5:5555'), true);
eq('isWifiSerial mdns', w.isWifiSerial('adb-RZCX-abc._adb-tls-connect._tcp'), true);
eq('isWifiSerial usb', w.isWifiSerial('RZCXB0AP8DZ'), false);
eq('isWifiSerial emulator', w.isWifiSerial('emulator-5554'), false);
eq('parseAdbDevices', w.parseAdbDevices('List of devices attached\nRZ1  device usb:1 product:a model:SM_A556E device:a\n192.168.1.5:5555 unauthorized\n10.0.0.2:5555\toffline\n\n'),
  [{ serial: 'RZ1', state: 'device', model: 'SM A556E' }, { serial: '192.168.1.5:5555', state: 'unauthorized', model: '' }, { serial: '10.0.0.2:5555', state: 'offline', model: '' }]);
const ipOut = [
  '1: lo    inet 127.0.0.1/8 scope host lo',
  '12: rmnet_data0    inet 10.150.3.4/30 scope global rmnet_data0',
  '47: wlan0    inet 192.168.1.110/24 brd 192.168.1.255 scope global wlan0',
  '50: swlan0    inet 192.168.43.1/24 brd 192.168.43.255 scope global swlan0',
  '51: rndis0    inet 192.168.42.129/24 scope global rndis0',
  '52: tun0    inet 10.8.0.2/24 scope global tun0',
].join('\n');
eq('parseDeviceIps กรอง lo/มือถือ/USB tether/VPN', w.parseDeviceIps(ipOut), [{ iface: 'wlan0', ip: '192.168.1.110', prefix: 24 }, { iface: 'swlan0', ip: '192.168.43.1', prefix: 24 }]);
const nets = w.macNets({
  lo0: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
  en0: [{ family: 'IPv4', address: '192.168.1.150', netmask: '255.255.255.0', internal: false }, { family: 'IPv6', address: 'fe80::1', netmask: 'ffff::', internal: false }],
  utun3: [{ family: 'IPv4', address: '10.99.0.2', netmask: '255.255.255.0', internal: false }],
  bridge100: [{ family: 'IPv4', address: '192.168.2.1', netmask: '255.255.255.0', internal: false }],
});
eq('macNets ข้าม loopback/utun/IPv6', nets, [{ iface: 'en0', ip: '192.168.1.150', prefix: 24 }, { iface: 'bridge100', ip: '192.168.2.1', prefix: 24 }]);
eq('pick: Wi-Fi วงเดียวกัน', w.pickReachableIp(w.parseDeviceIps(ipOut), nets), { ip: '192.168.1.110', iface: 'wlan0', macIp: '192.168.1.150', macIface: 'en0' });
eq('pick: Mac เกาะ hotspot มือถือ', w.pickReachableIp(w.parseDeviceIps(ipOut), [{ iface: 'en0', ip: '192.168.43.77', prefix: 24 }]), { ip: '192.168.43.1', iface: 'swlan0', macIp: '192.168.43.77', macIface: 'en0' });
eq('pick: มือถือเกาะ Internet Sharing ของ Mac', w.pickReachableIp([{ iface: 'wlan0', ip: '192.168.2.5', prefix: 24 }], nets), { ip: '192.168.2.5', iface: 'wlan0', macIp: '192.168.2.1', macIface: 'bridge100' });
eq('pick: คนละวง → null', w.pickReachableIp([{ iface: 'wlan0', ip: '10.0.0.5', prefix: 24 }], nets), null);
eq('pick: ไม่มี USB-tether IP แม้วงตรง', w.pickReachableIp(w.parseDeviceIps('5: rndis0    inet 192.168.1.9/24 scope global rndis0'), nets), null);
eq('parseMdns', w.parseMdns('List of discovered mdns services\nadb-RZ1-x1 _adb-tls-connect._tcp 192.168.1.110:38211\nadb-RZ1-x1 _adb-tls-pairing._tcp 192.168.1.110:41235\n'),
  [{ name: 'adb-RZ1-x1', type: 'connect', host: '192.168.1.110:38211' }, { name: 'adb-RZ1-x1', type: 'pairing', host: '192.168.1.110:41235' }]);
eq('connectOk', [w.connectOk('connected to 1.2.3.4:5555'), w.connectOk('already connected to 1.2.3.4:5555'), w.connectOk('failed to connect to 1.2.3.4:5555'), w.connectOk('cannot connect to 1.2.3.4:5555: Connection refused')], [true, true, false, false]);
eq('pairOk', [w.pairOk('Successfully paired to 1.2.3.4:41235 [guid=adb-X]'), w.pairOk('Failed: Wrong password or connection was dropped.')], [true, false]);
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
