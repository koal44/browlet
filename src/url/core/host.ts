export type Host = Domain | IPAddress | OpaqueHost | EmptyHost;

export type IPAddress = IPv4Address | IPv6Address;

export type Domain = {
  kind: 'domain';
  value: string;
};

export type IPv4Address = {
  kind: 'ipv4';
  value: number;
};

export type IPv6Address = {
  kind: 'ipv6';
  pieces: IPv6Pieces;
};

export type IPv6Pieces = [
  number, number, number, number, number, number, number, number,
];

export type OpaqueHost = {
  kind: 'opaque';
  value: string;
};

export type EmptyHost = {
  kind: 'empty';
};

export function serializeHost(host: Host): string {
  switch (host.kind) {
    case 'ipv4':
      return serializeIPv4(host);
    case 'ipv6':
      return `[${serializeIPv6(host)}]`;
    case 'empty':
      return '';
    default:
      return host.value;
  }
}

function serializeIPv4(address: IPv4Address): string {
  let output = '';
  let n = address.value;

  for (let i = 1; i <= 4; i++) {
    output = `${n % 256}${output}`;
    if (i !== 4) output = `.${output}`;
    n = Math.floor(n / 256);
  }

  return output;
}

function serializeIPv6(address: IPv6Address): string {
  let output = '';
  const compress = findIPv6CompressedPieceIndex(address);
  let ignore0 = false;

  for (let pieceIndex = 0; pieceIndex < address.pieces.length; pieceIndex++) {
    const piece = address.pieces[pieceIndex]!;

    if (ignore0 && piece === 0) continue;
    if (ignore0) ignore0 = false;

    if (compress === pieceIndex) {
      output += pieceIndex === 0 ? '::' : ':';
      ignore0 = true;
      continue;
    }

    output += piece.toString(16);
    if (pieceIndex !== 7) output += ':';
  }

  return output;
}

function findIPv6CompressedPieceIndex(address: IPv6Address): number | null {
  let longestIndex: number | null = null;
  let longestSize = 1;
  let foundIndex: number | null = null;
  let foundSize = 0;

  for (let pieceIndex = 0; pieceIndex < address.pieces.length; pieceIndex++) {
    if (address.pieces[pieceIndex] !== 0) {
      if (foundSize > longestSize) {
        longestIndex = foundIndex;
        longestSize = foundSize;
      }
      foundIndex = null;
      foundSize = 0;
    } else {
      foundIndex ??= pieceIndex;
      foundSize++;
    }
  }

  return foundSize > longestSize ? foundIndex : longestIndex;
}
