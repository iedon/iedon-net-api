const { DataTypes } = require('sequelize');
module.exports = sequelize => sequelize.define('settings', {
    key: {
        field: 'key',
        primaryKey: true,
        type: DataTypes.STRING,
        allowNull: false
    },
    value: {
        field: 'value',
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    }
}, {
    timestamps: false
});
