'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('attendance', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      zk_id: {
        type: Sequelize.STRING(4),
        allowNull: false,
        comment: 'Reference to users.zk_id',
        references: {
          model: 'users',
          key: 'zk_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      time_in: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Timestamp when user checked in'
      },
      time_out: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Timestamp when user checked out'
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    }, {
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci',
      timestamps: true,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    });

    // Add index on zk_id for faster lookups
    await queryInterface.addIndex('attendance', ['zk_id']);
    
    // Add composite index for common queries
    await queryInterface.addIndex('attendance', ['zk_id', 'created_at']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('attendance');
  }
};
