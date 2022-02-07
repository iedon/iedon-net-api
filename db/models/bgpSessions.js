const { DataTypes } = require('sequelize');
module.exports = sequelize => sequelize.define('bgp_sessions', {
    uuid: {
        field: 'uuid',
        primaryKey: true,
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4
    },
    router: {
        field: 'router',
        type: DataTypes.UUID,
        allowNull: false,
        unique: 'bgp_sessions_uniq'
    },
    asn: {
        field: 'asn',
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        unique: 'bgp_sessions_uniq'
    },
    status: {
        field: 'status',
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: true,
        comment: 'e.g.: -1: pending review, 0: disabled, 1: enabled'
    },
    ipv4: {
        field: 'ipv4',
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    ipv6: {
        field: 'ipv6',
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    ipv6LinkLocal: {
        field: 'ipv6_link_local',
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    type: {
        field: 'type',
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'wireguard',
        comment: 'e.g.: direct, wireguard, openvpn, ipsec, gre'
    },
    extensions: {
        field: 'extensions',
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'e.g.: ["mp-bgp","extended-nexthop"]'
    },
    interface: {
        field: 'interface',
        type: DataTypes.STRING,
        allowNull: false,
        unique: 'bgp_sessions_uniq'
    },
    endpoint: {
        field: 'endpoint',
        type: DataTypes.STRING,
        allowNull: true
    },
    credential: {
        field: 'credential',
        type: DataTypes.TEXT,
        allowNull: true
    },
    data: {
        field: 'data',
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    indexes: [
        {
            unique: false,
            name: 'idx_bgp_sessions_asn',
            fields: [ 'asn' ]
        },
        {
            unique: false,
            name: 'idx_bgp_sessions_router',
            fields: [ 'router' ]
        }
    ],
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
});
