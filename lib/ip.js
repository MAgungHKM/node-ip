var ip = exports;
var { Buffer } = require('buffer');
var os = require('os');

ip.toBuffer = function (ip, buff, offset) {
  offset = ~~offset;

  var result;
  var sections;

  if (this.isV4Format(ip)) {
    result = buff || new Buffer(offset + 4);
    sections = ip.split(/\./g);
    sections.map((byte, i) => {
      // by default assume that the radix is 10
      var radix = 10;
      // if the buffer has at least 2 characters and starts with 0
      if (byte.length > 1 && byte[0] === '0') {
        // the radix is either 16 if it start with 0x or 8 if it starts with 0
        radix = (byte[1] === 'x' || byte[1] === 'X') ? 16 : 8;
      }
      // if it's the last section - then it parse the section to the last index, otherwise according to the offset
      // for example - parsing "127" should yield "0.0.0.1", while "127.1" should yield "127.0.0.1"
      var index = sections.length - 1 === i ? offset + 3 : offset + i;
      result[index] = parseInt(byte, radix) & 0xff;
    });
  } else if (this.isV6Format(ip)) {
    sections = ip.split(':', 8);

    var i;
    for (i = 0; i < sections.length; i++) {
      // since "1" is both a valid IPv4 and a IPv6 element, we verify if it's an IPv6 element first and skip it in that case
      if (ipv6ElementRegex.test(sections[i])) {
        continue;
      }
      var isv4 = this.isV4Format(sections[i]);
      var v4Buffer;

      if (isv4) {
        v4Buffer = this.toBuffer(sections[i]);
        sections[i] = v4Buffer.slice(0, 2).toString('hex');
      }

      if (v4Buffer && ++i < 8) {
        sections.splice(i, 0, v4Buffer.slice(2, 4).toString('hex'));
      }
    }

    if (sections[0] === '') {
      while (sections.length < 8) sections.unshift('0');
    } else if (sections[sections.length - 1] === '') {
      while (sections.length < 8) sections.push('0');
    } else if (sections.length < 8) {
      for (i = 0; i < sections.length && sections[i] !== ''; i++);
      var argv = [i, 1];
      for (i = 9 - sections.length; i > 0; i--) {
        argv.push('0');
      }
      sections.splice.apply(sections, argv);
    }

    result = buff || new Buffer(offset + 16);
    for (i = 0; i < sections.length; i++) {
      var word = parseInt(sections[i], 16);
      result[offset++] = (word >> 8) & 0xff;
      result[offset++] = word & 0xff;
    }
  }

  if (!result) {
    throw Error(`Invalid ip address: ${ip}`);
  }

  return result;
};

ip.toString = function (buff, offset, length) {
  offset = ~~offset;
  length = length || (buff.length - offset);

  var result = [];
  var i;
  if (length === 4) {
    // IPv4
    for (i = 0; i < length; i++) {
      result.push(buff[offset + i]);
    }
    result = result.join('.');
  } else if (length === 16) {
    // IPv6
    for (i = 0; i < length; i += 2) {
      result.push(buff.readUInt16BE(offset + i).toString(16));
    }
    result = result.join(':');
    result = result.replace(/(^|:)0(:0)*:0(:|$)/, '$1::$3');
    result = result.replace(/:{3,4}/, '::');
  }

  return result;
};

var ipv6ElementRegex = /^[0-9a-f]{0,4}$/i;
var ipv4Regex = /^(((0x[0-9a-f]{1,2})|(\d{1,4}))\.){0,3}((0x[0-9a-f]{1,2})|(\d{1,4})){1,3}$/i;
var ipv6Regex = /^(::)?(((\d{1,3}\.){3}(\d{1,3}){1})?([0-9a-f]){0,4}:{0,2}){1,8}(::)?$/i;

ip.isV4Format = function (ip) {
  return ipv4Regex.test(ip);
};

ip.isV6Format = function (ip) {
  return ipv6Regex.test(ip);
};

function _normalizeFamily(family) {
  if (family === 4) {
    return 'ipv4';
  }
  if (family === 6) {
    return 'ipv6';
  }
  return family ? family.toLowerCase() : 'ipv4';
}

ip.fromPrefixLen = function (prefixlen, family) {
  if (prefixlen > 32) {
    family = 'ipv6';
  } else {
    family = _normalizeFamily(family);
  }

  var len = 4;
  if (family === 'ipv6') {
    len = 16;
  }
  var buff = new Buffer(len);

  for (var i = 0, n = buff.length; i < n; ++i) {
    var bits = 8;
    if (prefixlen < 8) {
      bits = prefixlen;
    }
    prefixlen -= bits;

    buff[i] = ~(0xff >> bits) & 0xff;
  }

  return ip.toString(buff);
};

ip.mask = function (addr, mask) {
  addr = ip.toBuffer(addr);
  mask = ip.toBuffer(mask);

  var result = new Buffer(Math.max(addr.length, mask.length));

  // Same protocol - do bitwise and
  var i;
  if (addr.length === mask.length) {
    for (i = 0; i < addr.length; i++) {
      result[i] = addr[i] & mask[i];
    }
  } else if (mask.length === 4) {
    // IPv6 address and IPv4 mask
    // (Mask low bits)
    for (i = 0; i < mask.length; i++) {
      result[i] = addr[addr.length - 4 + i] & mask[i];
    }
  } else {
    // IPv6 mask and IPv4 addr
    for (i = 0; i < result.length - 6; i++) {
      result[i] = 0;
    }

    // ::ffff:ipv4
    result[10] = 0xff;
    result[11] = 0xff;
    for (i = 0; i < addr.length; i++) {
      result[i + 12] = addr[i] & mask[i + 12];
    }
    i += 12;
  }
  for (; i < result.length; i++) {
    result[i] = 0;
  }

  return ip.toString(result);
};

ip.cidr = function (cidrString) {
  var cidrParts = cidrString.split('/');

  var addr = cidrParts[0];
  if (cidrParts.length !== 2) {
    throw new Error(`invalid CIDR subnet: ${addr}`);
  }

  var mask = ip.fromPrefixLen(parseInt(cidrParts[1], 10));

  return ip.mask(addr, mask);
};

ip.subnet = function (addr, mask) {
  var networkAddress = ip.toLong(ip.mask(addr, mask));

  // Calculate the mask's length.
  var maskBuffer = ip.toBuffer(mask);
  var maskLength = 0;

  for (var i = 0; i < maskBuffer.length; i++) {
    if (maskBuffer[i] === 0xff) {
      maskLength += 8;
    } else {
      var octet = maskBuffer[i] & 0xff;
      while (octet) {
        octet = (octet << 1) & 0xff;
        maskLength++;
      }
    }
  }

  var numberOfAddresses = Math.pow(2, 32 - maskLength);

  return {
    networkAddress: ip.fromLong(networkAddress),
    firstAddress: numberOfAddresses <= 2
      ? ip.fromLong(networkAddress)
      : ip.fromLong(networkAddress + 1),
    lastAddress: numberOfAddresses <= 2
      ? ip.fromLong(networkAddress + numberOfAddresses - 1)
      : ip.fromLong(networkAddress + numberOfAddresses - 2),
    broadcastAddress: ip.fromLong(networkAddress + numberOfAddresses - 1),
    subnetMask: mask,
    subnetMaskLength: maskLength,
    numHosts: numberOfAddresses <= 2
      ? numberOfAddresses : numberOfAddresses - 2,
    length: numberOfAddresses,
    contains(other) {
      return networkAddress === ip.toLong(ip.mask(other, mask));
    },
  };
};

ip.cidrSubnet = function (cidrString) {
  var cidrParts = cidrString.split('/');

  var addr = cidrParts[0];
  if (cidrParts.length !== 2) {
    throw new Error(`invalid CIDR subnet: ${addr}`);
  }

  var mask = ip.fromPrefixLen(parseInt(cidrParts[1], 10));

  return ip.subnet(addr, mask);
};

ip.not = function (addr) {
  var buff = ip.toBuffer(addr);
  for (var i = 0; i < buff.length; i++) {
    buff[i] = 0xff ^ buff[i];
  }
  return ip.toString(buff);
};

ip.or = function (a, b) {
  var i;

  a = ip.toBuffer(a);
  b = ip.toBuffer(b);

  // same protocol
  if (a.length === b.length) {
    for (i = 0; i < a.length; ++i) {
      a[i] |= b[i];
    }
    return ip.toString(a);

  // mixed protocols
  }
  var buff = a;
  var other = b;
  if (b.length > a.length) {
    buff = b;
    other = a;
  }

  var offset = buff.length - other.length;
  for (i = offset; i < buff.length; ++i) {
    buff[i] |= other[i - offset];
  }

  return ip.toString(buff);
};

ip.isEqual = function (a, b) {
  var i;

  a = ip.toBuffer(a);
  b = ip.toBuffer(b);

  // Same protocol
  if (a.length === b.length) {
    for (i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // Swap
  if (b.length === 4) {
    var t = b;
    b = a;
    a = t;
  }

  // a - IPv4, b - IPv6
  for (i = 0; i < 10; i++) {
    if (b[i] !== 0) return false;
  }

  var word = b.readUInt16BE(10);
  if (word !== 0 && word !== 0xffff) return false;

  for (i = 0; i < 4; i++) {
    if (a[i] !== b[i + 12]) return false;
  }

  return true;
};

ip.isPrivate = function (addr) {
  if (ip.isLoopback(addr)) return true;
  var parsed = ip.toBuffer(addr);
  if ((parsed.length === 16 && parsed[0] === 0 && parsed[1] === 0 && parsed[2] === 0 && parsed[3] === 0 && parsed[4] === 0 && parsed[5] === 0 && parsed[6] === 0 && parsed[7] === 0 && parsed[8] === 0 && parsed[9] === 0 && parsed[10] === 0xff && parsed[11] === 0xff) || 
      parsed.length === 4) {
    return (parsed[parsed.length - 4] === 10) || 
      (parsed[parsed.length - 4] === 192 && parsed[parsed.length - 3] === 168) || 
      (parsed[parsed.length - 4] === 172 && (parsed[parsed.length - 3] >= 16 && parsed[parsed.length - 3] <= 31)) || 
      (parsed[parsed.length - 4] === 169 && parsed[parsed.length - 3] === 254);
  } else if (parsed.length === 16) {
    if (parsed[0] === 0xfc || parsed[0]  === 0xfd) return true;
  }
  return false;
};

ip.isPublic = function (addr) {
  return !ip.isPrivate(addr);
};

ip.isLoopback = function (addr) {
  var parsed = ip.toBuffer(addr);
  if ((parsed.length === 16 && parsed[0] === 0 && parsed[1] === 0 && parsed[2] === 0 && parsed[3] === 0 && parsed[4] === 0 && parsed[5] === 0 && parsed[6] === 0 && parsed[7] === 0 && parsed[8] === 0 && parsed[9] === 0 && parsed[10] === 0xff && parsed[11] === 0xff) || 
      parsed.length === 4) {
    return parsed[parsed.length - 4] === 127;
  } else if (parsed.length === 16) {
    if (parsed[0] === 0xfe && parsed[1]  === 0x80) return true;
    if (parsed[0] === 0 && parsed[1] === 0 && parsed[2] === 0 && parsed[3] === 0 && parsed[4] === 0 && parsed[5] === 0 && parsed[6] === 0 && parsed[7] === 0 && parsed[8] === 0 && parsed[9] === 0 && parsed[10] === 0 && parsed[11] === 0 && parsed[12] === 0 && parsed[13] === 0 && parsed[14] === 0 && (parsed[15] === 0 || parsed[15] === 1)) return true;
  }
  return false;
};

ip.loopback = function (family) {
  //
  // Default to `ipv4`
  //
  family = _normalizeFamily(family);

  if (family !== 'ipv4' && family !== 'ipv6') {
    throw new Error('family must be ipv4 or ipv6');
  }

  return family === 'ipv4' ? '127.0.0.1' : 'fe80::1';
};

//
// ### function address (name, family)
// #### @name {string|'public'|'private'} **Optional** Name or security
//      of the network interface.
// #### @family {ipv4|ipv6} **Optional** IP family of the address (defaults
//      to ipv4).
//
// Returns the address for the network interface on the current system with
// the specified `name`:
//   * String: First `family` address of the interface.
//             If not found see `undefined`.
//   * 'public': the first public ip address of family.
//   * 'private': the first private ip address of family.
//   * undefined: First address with `ipv4` or loopback address `127.0.0.1`.
//
ip.address = function (name, family) {
  var interfaces = os.networkInterfaces();

  //
  // Default to `ipv4`
  //
  family = _normalizeFamily(family);

  //
  // If a specific network interface has been named,
  // return the address.
  //
  if (name && name !== 'private' && name !== 'public') {
    var res = interfaces[name].filter((details) => {
      var itemFamily = _normalizeFamily(details.family);
      return itemFamily === family;
    });
    if (res.length === 0) {
      return undefined;
    }
    return res[0].address;
  }

  var all = Object.keys(interfaces).map((nic) => {
    //
    // Note: name will only be `public` or `private`
    // when this is called.
    //
    var addresses = interfaces[nic].filter((details) => {
      details.family = _normalizeFamily(details.family);
      if (details.family !== family || ip.isLoopback(details.address)) {
        return false;
      } if (!name) {
        return true;
      }

      return name === 'public' ? ip.isPrivate(details.address)
        : ip.isPublic(details.address);
    });

    return addresses.length ? addresses[0].address : undefined;
  }).filter(Boolean);

  return !all.length ? ip.loopback(family) : all[0];
};

ip.toLong = function (ip) {
  var ipl = 0;
  ip.split('.').forEach((octet) => {
    ipl <<= 8;
    ipl += parseInt(octet);
  });
  return (ipl >>> 0);
};

ip.fromLong = function (ipl) {
  return (`${ipl >>> 24}.${
    ipl >> 16 & 255}.${
    ipl >> 8 & 255}.${
    ipl & 255}`);
};
