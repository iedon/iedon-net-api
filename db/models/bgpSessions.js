import sequelize from "sequelize";
const { DataTypes } = sequelize;

export const initModel = (sequelize) =>
  sequelize.define(
    "bgp_sessions",
    {
      uuid: {
        field: "uuid",
        primaryKey: true,
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
      },
      router: {
        field: "router",
        type: DataTypes.UUID,
        allowNull: false,
        unique: "bgp_sessions_uniq",
      },
      asn: {
        field: "asn",
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        unique: "bgp_sessions_uniq",
      },
      status: {
        field: "status",
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
        comment: "e.g.: 1: disabled, 2: enabled, 3: pending review, 4: queued for setup, 5: queued for delete, 6: problem, 7: teardown",
      },
      mtu: {
        field: "mtu",
        type: DataTypes.SMALLINT.UNSIGNED,
        allowNull: false,
        defaultValue: 1280,
        comment:
          "e.g.: 1420: default for wireguard, 1500: default for ethernet",
      },
      policy: {
        field: "policy",
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
        comment:
          "e.g.: 0: full/transit(send and recv all valid), 1: peer(send own, recv their owned), 2: upstream(send all valid, recv their owned), 3: downstream(send own, recv all valid)",
      },
      ipv4: {
        field: "ipv4",
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      },
      ipv6: {
        field: "ipv6",
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      },
      ipv6LinkLocal: {
        field: "ipv6_link_local",
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      },
      type: {
        field: "type",
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "wireguard",
        comment: "e.g.: direct, wireguard, openvpn, ipsec, gre, ip6gre",
      },
      extensions: {
        field: "extensions",
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'e.g.: ["mp-bgp","extended-nexthop"]',
      },
      interface: {
        field: "interface",
        type: DataTypes.STRING,
        allowNull: false,
        unique: "bgp_sessions_uniq",
      },
      endpoint: {
        field: "endpoint",
        type: DataTypes.STRING,
        allowNull: true,
      },
      credential: {
        field: "credential",
        type: DataTypes.TEXT,
        allowNull: true,
      },
      data: {
        field: "data",
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      indexes: [
        {
          unique: false,
          name: "idx_bgp_sessions_asn",
          fields: ["asn"],
        },
        {
          unique: false,
          name: "idx_bgp_sessions_router",
          fields: ["router"],
        },
        {
          unique: false,
          name: "idx_bgp_sessions_interface",
          fields: ["interface"],
        },
      ],
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );
