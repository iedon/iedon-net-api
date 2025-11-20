import sequelize from "sequelize";
const { DataTypes } = sequelize;

export const initModel = (sequelize) =>
  sequelize.define(
    "routers",
    {
      uuid: {
        field: "uuid",
        primaryKey: true,
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
      },
      name: {
        field: "name",
        unique: "routers_uniq",
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        field: "description",
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null,
      },
      agentSecret: {
        field: "agent_secret",
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "",
      },
      location: {
        field: "location",
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      },
      public: {
        field: "public",
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      openPeering: {
        field: "open_peering",
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      autoPeering: {
        field: "auto_peering",
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      sessionCapacity: {
        field: "session_capacity",
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 30,
      },
      callbackUrl: {
        field: "callback_url",
        type: DataTypes.STRING,
        allowNull: false,
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
      linkTypes: {
        field: "link_types",
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '["wireguard"]',
        comment: 'e.g.: ["direct", "wireguard", "openvpn", "gre", "ip6gre"]',
      },
      extensions: {
        field: "extensions",
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'e.g.: ["mp-bgp", "extended-nexthop"]',
      },
      allowedPolicies: {
        field: "allowed_policies",
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "[0,1,2,3,4]",
        comment:
          "ROUTING_POLICY. e.g.: [0, 1, 2, 3, 4] 0: full/transit(send and recv all valid), 1: peer(send own, recv their owned), 2: upstream(send all valid, recv their owned), 3: downstream(send own, recv all valid), 4: upstream, admin/internal only",
      },
    },
    {
      timestamps: false,
    }
  );
