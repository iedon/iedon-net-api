import sequelize from 'sequelize';
const { DataTypes } = sequelize;

export const initModel = sequelize => sequelize.define('peer_preferences', {
  asn: {
    field: 'asn',
    primaryKey: true,
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false
  },
  password: {
    field: 'password',
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});
