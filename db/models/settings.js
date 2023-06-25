import sequelize from 'sequelize';
const { DataTypes } = sequelize;

export const initModel = sequelize => sequelize.define('settings', {
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
