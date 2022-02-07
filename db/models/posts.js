const { DataTypes } = require('sequelize');
module.exports = sequelize => sequelize.define('posts', {
    postId: {
        field: 'post_id',
        primaryKey: true,
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true
    },
    category: {
        field: 'category',
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Default',
    },
    title: {
        field: 'title',
        type: DataTypes.STRING,
        allowNull: false
    },
    content: {
        field: 'content',
        type: DataTypes.TEXT,
        allowNull: false
    }
}, {
    indexes: [
        {
            unique: false,
            name: 'idx_posts_title',
            fields: [ 'title' ]
        },
        {
            unique: false,
            name: 'idx_posts_category',
            fields: [ 'category' ]
        }
    ],
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
});
