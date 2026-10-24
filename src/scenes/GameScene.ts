import Phaser from 'phaser';
import { AudioService } from '../audio/AudioService';
import { StorageService } from '../utils/StorageService';
import { GameSettings } from '../utils/GameSettings';

interface Question {
  text: string;
  options: string[];
  correct: number;
  explanation: string;
}

export class GameScene extends Phaser.Scene {
  private probe!: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  
  private blackHoleX = 512;
  private blackHoleY = 300;
  private gravityStrength = 18000; // Force pulling towards center
  
  private orbs!: Phaser.Physics.Arcade.Group;
  private score = 0;
  private scoreText!: Phaser.GameObjects.Text;
  
  private lives = 3;
  private livesText!: Phaser.GameObjects.Text;
  
  private activeQuestion: Question | null = null;
  private quizActive = false;
  private dialogPanel!: Phaser.GameObjects.Container;
  
  private isLeftDown = false;
  private isRightDown = false;
  private isUpDown = false;
  
  private quizQuestions: Question[] = [
    {
      text: '¿Qué es el "Horizonte de Sucesos" de un agujero negro?',
      options: [
        'A) La zona segura para naves espaciales.',
        'B) El límite a partir del cual nada puede escapar.',
        'C) El momento en que nace la estrella.'
      ],
      correct: 1,
      explanation: '¡Correcto! El Horizonte de Sucesos es la frontera del no retorno. Una vez cruzada, la gravedad es tan alta que ni la luz escapa.'
    },
    {
      text: '¿Cómo se forma un agujero negro estelar?',
      options: [
        'A) Por el colapso de una estrella gigante al morir.',
        'B) Por la colisión de dos pequeños cometas.',
        'C) Por el choque de gas caliente en la atmósfera.'
      ],
      correct: 0,
      explanation: '¡Excelente! Se forman cuando una estrella masiva colapsa por completo al agotarse su combustible nuclear.'
    },
    {
      text: '¿Qué hay teóricamente en el centro de un agujero negro?',
      options: [
        'A) Un portal a otra galaxia idéntica.',
        'B) Una estrella de neutrones activa.',
        'C) La Singularidad, un punto de densidad infinita.'
      ],
      correct: 2,
      explanation: '¡Así es! En la singularidad se concentra toda la masa en un espacio infinitamente pequeño, rompiendo las leyes de la física clásica.'
    }
  ];

  constructor() {
    super('GameScene');
  }

  create(): void {
    // Reset properties upon scene re-entry
    this.score = 0;
    this.lives = 3;
    this.quizActive = false;
    
    // Play deep hum for black hole
    AudioService.playBlackHoleHum();
    this.events.once('shutdown', () => {
      AudioService.stopBlackHoleHum();
    });
    
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    // Physics boundary setup
    this.physics.world.setBounds(0, 0, width, height);

    // Dark space background
    const bg = this.add.graphics();
    bg.fillStyle(0x060314, 1);
    bg.fillRect(0, 0, width, height);

    // Stars
    for (let i = 0; i < 80; i++) {
      this.add.circle(Phaser.Math.Between(0, width), Phaser.Math.Between(0, height), Phaser.Math.FloatBetween(0.5, 2), 0xffffff, Phaser.Math.FloatBetween(0.1, 0.7));
    }

    // Black Hole (visual)
    const bhGlow = this.add.circle(this.blackHoleX, this.blackHoleY, 80, 0xff5500, 0.25);
    this.add.circle(this.blackHoleX, this.blackHoleY, 30, 0x000000, 1);
    
    // Rotating swirl
    const bhSwirl = this.add.graphics();
    bhSwirl.lineStyle(4, 0x9c27b0, 0.6);
    bhSwirl.strokeCircle(this.blackHoleX, this.blackHoleY, 50);
    bhSwirl.lineStyle(2, 0xff5722, 0.4);
    bhSwirl.strokeCircle(this.blackHoleX, this.blackHoleY, 65);

    this.tweens.add({
      targets: bhGlow,
      scale: 1.2,
      alpha: 0.4,
      duration: 1500,
      yoyo: true,
      repeat: -1
    });

    this.tweens.add({
      targets: bhSwirl,
      angle: 360,
      duration: 6000,
      repeat: -1
    });

    // Score display
    this.scoreText = this.add.text(20, 20, `Sondas recolectadas: ${this.score}/3`, {
      font: 'bold 20px "Outfit", "Inter", sans-serif',
      color: '#ffffff'
    });

    this.livesText = this.add.text(20, 50, `Vidas: ${this.lives}/3`, {
      font: 'bold 20px "Outfit", "Inter", sans-serif',
      color: '#ff5555'
    });

    // Controls description
    this.add.text(20, height - 40, 'Controles: Teclas de Dirección (Flechas) para pilotar la sonda. ¡Evita el tirón del Agujero Negro!', {
      font: '14px "Outfit", "Inter", sans-serif',
      color: '#a092ff'
    });

    // Exit to Menu button
    const exitBtn = this.add.text(width - 20, 20, '✖ SALIR', {
      font: 'bold 16px "Outfit", "Inter", sans-serif',
      color: '#ff5555',
      backgroundColor: '#220000',
      padding: { x: 10, y: 5 }
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });

    exitBtn.on('pointerover', () => exitBtn.setColor('#ffffff'));
    exitBtn.on('pointerout', () => exitBtn.setColor('#ff5555'));
    exitBtn.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.cameras.main.fadeOut(400, 10, 5, 27);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('MainMenuScene');
      });
    });

    // Player Probe Physics Image

    this.probe = this.physics.add.image(150, 150, 'player_probe');
    this.probe.setCollideWorldBounds(true);
    this.probe.setDamping(true);
    this.probe.setDrag(0.98);
    this.probe.setMaxVelocity(300);

    // Collectible data orbs
    this.orbs = this.physics.add.group();
    
    // Position 3 orbs at safe distances orbiting the black hole
    const orbCoords = [
      { x: 300, y: 200 },
      { x: 700, y: 220 },
      { x: 520, y: 480 }
    ];

    // Create orb graphics and load

    orbCoords.forEach((coord) => {
      const orb = this.orbs.create(coord.x, coord.y, 'data_orb') as Phaser.Physics.Arcade.Image;
      orb.setBounce(1);
      // Floating motion
      this.tweens.add({
        targets: orb,
        y: coord.y - 15,
        duration: 1000 + Math.random() * 500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    });

    // Keyboard controls
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();

      // Atajo: P pasa el nivel al instante (para pruebas)
      this.input.keyboard.addKey('P').on('down', () => {
        if (!this.quizActive) this.completeLevel();
      });
    }

    // Overlap trigger between player and orbs
    this.physics.add.overlap(this.probe, this.orbs, this.collectOrb, undefined, this);

    // Dialog modal container for scientific questions (hidden initially)
    this.createDialogPanel();
    
    this.createMobileControls();
  }

  update(): void {
    if (this.quizActive) {
      // Disable movement and gravity during quiz
      this.probe.setVelocity(0);
      return;
    }

    // 1. Apply Gravitational Pull towards the Black Hole
    const dx = this.blackHoleX - this.probe.x;
    const dy = this.blackHoleY - this.probe.y;
    const distanceSq = dx * dx + dy * dy;
    const distance = Math.sqrt(distanceSq);

    if (distance < 50) {
      // Pulled into event horizon! 
      AudioService.playSFX('incorrect');
      this.cameras.main.flash(500, 255, 0, 0);
      
      this.lives--;
      this.livesText.setText(`Vidas: ${this.lives}/3`);
      
      if (this.lives <= 0) {
        this.showGameOver();
      } else {
        this.resetProbe();
      }
      return;
    }

    // Gravity calculation (F = G * m1 * m2 / r^2)
    // We simplify this into an acceleration vector
    if (distance < 450) {
      // La fuerza se ajusta en Configuración → Guante (por defecto 50 %)
      const force = (this.gravityStrength * GameSettings.getGravityPercent() / 100) / distanceSq;
      const accelX = (dx / distance) * force * 100;
      const accelY = (dy / distance) * force * 100;
      this.probe.setAcceleration(accelX, accelY);
    } else {
      this.probe.setAcceleration(0, 0);
    }

    // 2. Player Input Handling
    const controlType = this.registry.get('controlType') || 'keyboard';
    const speed = 200;

    // Con toque/mouse presionado se sigue el dedo; si no, flechas (teclado o guante)
    if (controlType === 'pointer' && this.input.activePointer.isDown) {
      this.probe.setAngularVelocity(0);
      const pointer = this.input.activePointer;
      if (pointer.isDown) {
        // + Math.PI/2 because the probe graphic points UP (which is -90 degrees)
        const targetAngle = Phaser.Math.Angle.Between(this.probe.x, this.probe.y, pointer.x, pointer.y) + Math.PI/2;
        let diff = Phaser.Math.Angle.Wrap(targetAngle - this.probe.rotation);
        
        // Smooth rotational follow
        this.probe.setAngularVelocity(diff * 300);

        this.physics.velocityFromRotation(this.probe.rotation - Math.PI/2, speed, this.probe.body.velocity);
      }
    } else {
      let moveLeft = this.isLeftDown;
      let moveRight = this.isRightDown;
      let moveUp = this.isUpDown;

      if (this.cursors) {
        if (this.cursors.left.isDown) moveLeft = true;
        if (this.cursors.right.isDown) moveRight = true;
        if (this.cursors.up.isDown) moveUp = true;
      }

      if (moveLeft) {
        this.probe.setAngularVelocity(-200);
      } else if (moveRight) {
        this.probe.setAngularVelocity(200);
      } else {
        this.probe.setAngularVelocity(0);
      }

      if (moveUp) {
        // Accelerate in the direction the probe is pointing
        this.physics.velocityFromRotation(this.probe.rotation - Math.PI/2, speed, this.probe.body.velocity);
      }
    }
  }

  private createMobileControls(): void {
    if (this.registry.get('controlType') !== 'virtual_buttons') return;

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    // Controls container
    const controls = this.add.container(0, 0);
    controls.setDepth(50); // Ensure they are above stars but below dialogs

    const drawButton = (x: number, y: number, color: number, text: string, callbackDown: () => void, callbackUp: () => void) => {
      const btn = this.add.graphics();
      btn.fillStyle(color, 0.4);
      btn.fillCircle(x, y, 40);
      btn.lineStyle(2, color, 0.8);
      btn.strokeCircle(x, y, 40);
      controls.add(btn);

      const label = this.add.text(x, y, text, {
        fontSize: '24px',
        color: '#ffffff',
        fontStyle: 'bold'
      }).setOrigin(0.5);
      controls.add(label);

      const zone = this.add.zone(x, y, 80, 80).setInteractive();
      controls.add(zone);

      zone.on('pointerdown', () => {
        btn.clear();
        btn.fillStyle(color, 0.7);
        btn.fillCircle(x, y, 40);
        btn.lineStyle(2, color, 1);
        btn.strokeCircle(x, y, 40);
        callbackDown();
      });
      const resetBtn = () => {
        btn.clear();
        btn.fillStyle(color, 0.4);
        btn.fillCircle(x, y, 40);
        btn.lineStyle(2, color, 0.8);
        btn.strokeCircle(x, y, 40);
        callbackUp();
      };
      zone.on('pointerup', resetBtn);
      zone.on('pointerout', resetBtn);
    };

    drawButton(70, height - 70, 0x00e5ff, '<', () => this.isLeftDown = true, () => this.isLeftDown = false);
    drawButton(170, height - 70, 0x00e5ff, '>', () => this.isRightDown = true, () => this.isRightDown = false);
    drawButton(width - 70, height - 70, 0xffa500, '^', () => this.isUpDown = true, () => this.isUpDown = false);
  }

  private collectOrb(_probeObj: any, orbObj: any): void {
    const orb = orbObj as Phaser.GameObjects.GameObject;
    orb.destroy();

    // Trigger quiz dialog for this index
    const qIndex = this.score;
    this.score++;
    this.scoreText.setText(`Sondas recolectadas: ${this.score}/3`);

    this.showQuizQuestion(this.quizQuestions[qIndex]);
  }

  private resetProbe(): void {
    this.probe.setPosition(150, 150);
    this.probe.setVelocity(0);
    this.probe.setAcceleration(0, 0);
    this.probe.setRotation(0);
  }

  private createDialogPanel(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    this.dialogPanel = this.add.container(0, 0);
    this.dialogPanel.setVisible(false);
    this.dialogPanel.setDepth(100);

    // Semi-transparent backdrop overlay
    const backdrop = this.add.graphics();
    backdrop.fillStyle(0x000000, 0.7);
    backdrop.fillRect(0, 0, width, height);
    this.dialogPanel.add(backdrop);

    // Modal background
    const modalBg = this.add.graphics();
    modalBg.fillStyle(0x130d2d, 0.95);
    modalBg.lineStyle(4, 0xffa500, 1);
    modalBg.fillRoundedRect(width / 2 - 350, height / 2 - 200, 700, 400, 15);
    modalBg.strokeRoundedRect(width / 2 - 350, height / 2 - 200, 700, 400, 15);
    this.dialogPanel.add(modalBg);
  }

  private showQuizQuestion(q: Question): void {
    this.activeQuestion = q;
    this.quizActive = true;
    this.probe.setVelocity(0);

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    // Clear previous items in dialogPanel (keep backdrop and modalBg which are index 0 and 1)
    while (this.dialogPanel.list.length > 2) {
      this.dialogPanel.list[2].destroy();
    }

    const qText = this.add.text(width / 2, height / 2 - 160, q.text, {
      fontSize: '36px',
      fontFamily: 'Outfit, sans-serif',
      fontStyle: 'bold',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 660 }
    }).setOrigin(0.5);
    // Add subtle shadow to stand out more
    qText.setShadow(2, 2, '#000000', 4, true, true);
    this.dialogPanel.add(qText);

    // Options buttons
    q.options.forEach((opt, idx) => {
      const yPos = height / 2 - 40 + (idx * 60);

      // Button background shape
      const btnG = this.add.graphics();
      btnG.fillStyle(0x281c4e, 1);
      btnG.fillRoundedRect(width / 2 - 280, yPos - 22, 560, 44, 8);
      this.dialogPanel.add(btnG);

      const btnT = this.add.text(width / 2 - 260, yPos, opt, {
        fontSize: '17px',
        fontFamily: 'Outfit, sans-serif',
        fontStyle: 'bold',
        color: '#ffc107'
      }).setOrigin(0, 0.5);
      this.dialogPanel.add(btnT);

      // Interactive zone
      const btnZone = this.add.zone(width / 2, yPos, 560, 44).setInteractive({ useHandCursor: true });
      this.dialogPanel.add(btnZone);

      btnZone.on('pointerover', () => {
        btnG.clear();
        btnG.fillStyle(0x3e2c7a, 1);
        btnG.fillRoundedRect(width / 2 - 280, yPos - 22, 560, 44, 8);
      });

      btnZone.on('pointerout', () => {
        btnG.clear();
        btnG.fillStyle(0x281c4e, 1);
        btnG.fillRoundedRect(width / 2 - 280, yPos - 22, 560, 44, 8);
      });

      btnZone.on('pointerdown', () => {
        this.selectAnswer(idx);
      });
    });

    this.dialogPanel.setVisible(true);
  }

  private selectAnswer(index: number): void {
    if (!this.activeQuestion) return;

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    const isCorrect = index === this.activeQuestion.correct;

    // Play feedback sound
    AudioService.playSFX(isCorrect ? 'correct' : 'incorrect');

    // Clear question panel list beyond index 1 (backdrop and modalBg)
    while (this.dialogPanel.list.length > 2) {
      this.dialogPanel.list[2].destroy();
    }

    // Display Feedback Text
    const feedbackText = this.add.text(width / 2, height / 2 - 60, isCorrect ? '¡RESPUESTA CORRECTA!' : 'RESPUESTA INCORRECTA', {
      font: 'bold 32px "Outfit", sans-serif',
      color: isCorrect ? '#00e676' : '#ff1744',
      align: 'center'
    }).setOrigin(0.5);
    this.dialogPanel.add(feedbackText);

    const explanationText = this.add.text(width / 2, height / 2 + 10, isCorrect ? this.activeQuestion.explanation : 'Vuelve a recolectar esta sonda y pon atención. El Horizonte de sucesos es el límite de escape, la supernova inicia la formación, y la singularidad es el centro infinitamente denso.', {
      font: '20px "Outfit", sans-serif',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 600 }
    }).setOrigin(0.5);
    this.dialogPanel.add(explanationText);

    // Continuous button
    const btnContinue = this.add.graphics();
    btnContinue.fillStyle(isCorrect ? 0x00e676 : 0xff1744, 1);
    btnContinue.fillRoundedRect(width / 2 - 100, height / 2 + 100, 200, 44, 8);
    this.dialogPanel.add(btnContinue);

    const btnText = this.add.text(width / 2, height / 2 + 122, isCorrect ? 'CONTINUAR' : 'REINTENTAR', {
      font: 'bold 18px "Outfit", sans-serif',
      color: '#ffffff'
    }).setOrigin(0.5);
    this.dialogPanel.add(btnText);

    const continueZone = this.add.zone(width / 2, height / 2 + 122, 200, 44).setInteractive({ useHandCursor: true });
    this.dialogPanel.add(continueZone);

    continueZone.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.dialogPanel.setVisible(false);
      this.quizActive = false;

      if (!isCorrect) {
        // De-increment score and spawn back the orb to let them retry
        this.score--;
        this.scoreText.setText(`Sondas recolectadas: ${this.score}/3`);
        
        // Re-spawn the orb at a random place around the black hole
        const angle = Math.random() * Math.PI * 2;
        const radius = 250 + Math.random() * 150;
        const rx = this.blackHoleX + Math.cos(angle) * radius;
        const ry = this.blackHoleY + Math.sin(angle) * radius;
        
        const orb = this.orbs.create(rx, ry, 'data_orb') as Phaser.Physics.Arcade.Image;
        orb.setBounce(1);
        this.tweens.add({
          targets: orb,
          y: ry - 15,
          duration: 1000 + Math.random() * 500,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
      }

      // Check if all 3 probes collected and answered correctly
      if (this.score === 3) {
        this.completeLevel();
      }
    });
  }

  private completeLevel(): void {
    this.quizActive = true; // Block movement
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    // Clear dialog container
    while (this.dialogPanel.list.length > 2) {
      this.dialogPanel.list[2].destroy();
    }

    // Save progress to LocalStorage
    StorageService.setCurrentLevel(2);
    StorageService.unlockBadge('cazador'); // Hunter badge unlocked!
    AudioService.playSFX('achievement');

    const winTitle = this.add.text(width / 2, height / 2 - 100, '¡NIVEL COMPLETADO!', {
      font: 'bold 36px "Outfit", sans-serif',
      color: '#ffc107',
      align: 'center'
    }).setOrigin(0.5);
    this.dialogPanel.add(winTitle);

    const winDesc = this.add.text(width / 2, height / 2 - 10, 'Has superado el Agujero Negro y demostrado tu conocimiento.\n\n¡Obtuviste tu certificado!', {
      font: '20px "Outfit", sans-serif',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 600 }
    }).setOrigin(0.5);
    this.dialogPanel.add(winDesc);

    // Next Level button
    const btnMenu = this.add.graphics();
    btnMenu.fillStyle(0x00e5ff, 1);
    btnMenu.fillRoundedRect(width / 2 - 120, height / 2 + 130, 240, 48, 8);
    this.dialogPanel.add(btnMenu);

    const btnText = this.add.text(width / 2, height / 2 + 154, 'SIGUIENTE NIVEL', {
      font: 'bold 16px "Outfit", sans-serif',
      color: '#130d2d'
    }).setOrigin(0.5);
    this.dialogPanel.add(btnText);

    const menuZone = this.add.zone(width / 2, height / 2 + 154, 240, 48).setInteractive({ useHandCursor: true });
    this.dialogPanel.add(menuZone);

    menuZone.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.dialogPanel.setVisible(false);
      this.cameras.main.fadeOut(400, 10, 5, 27);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('Level2Scene');
      });
    });

    this.dialogPanel.setVisible(true);
  }

  private showGameOver(): void {
    this.quizActive = true;
    this.probe.setVelocity(0);
    this.probe.setAcceleration(0, 0);
    
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    
    const gameOverPanel = this.add.container(0, 0);
    gameOverPanel.setDepth(200);
    
    const bg = this.add.image(width / 2, height / 2, 'bg_game_over');
    const scale = Math.max(width / bg.width, height / bg.height);
    bg.setScale(scale);
    gameOverPanel.add(bg);
    
    const btnRetry = this.add.image(width / 2 - 220, height - 100, 'btn_reintentar').setInteractive({ useHandCursor: true });
    btnRetry.setScale(0.25);
    gameOverPanel.add(btnRetry);
    
    btnRetry.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.scene.restart();
    });
    
    const btnMenu = this.add.image(width / 2 + 220, height - 100, 'btn_volver_menu').setInteractive({ useHandCursor: true });
    btnMenu.setScale(0.25);
    gameOverPanel.add(btnMenu);
    
    btnMenu.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.scene.start('MainMenuScene');
    });
  }
}
